/* Suno tokens stay inside its signed-in page. Only lyric data crosses back. */
const SunoLyrics = (() => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function songID(value) {
    try {
      const url = new URL(value);
      const id = url.pathname.match(/^\/song\/([^/]+)\/?$/)?.[1];
      return url.protocol === 'https:' && url.hostname === 'suno.com' && uuid.test(id || '') ? id.toLowerCase() : null;
    } catch { return null; }
  }

  function toLRC(words) {
    if (!Array.isArray(words) || words.length > 20000) return '';
    const lines = [];
    let text = '', start;
    function flush() {
      const line = text.trim();
      const heading = /^(?:\[[^\]]*\]|\([^)]*\))$/.test(line) ||
        /^(?:(?:final|last)\s+)?(?:verse|chorus|pre[- ]?chorus|bridge|intro|outro|hook|refrain|instrumental)(?:\s+\d+)?(?:\s*\([^)]*\))?(?:\s*[:–-].*)?$/i.test(line);
      if (line && start !== undefined && !heading) {
        const centiseconds = Math.round(start * 100);
        const minutes = Math.floor(centiseconds / 6000);
        const seconds = ((centiseconds % 6000) / 100).toFixed(2).padStart(5, '0');
        lines.push('[' + String(minutes).padStart(2, '0') + ':' + seconds + ']' + line);
      }
      text = ''; start = undefined;
    }
    let previous = 0;
    for (const word of words) {
      if (typeof word?.word !== 'string' || word.word.length > 2000 || !Number.isFinite(word.start_s) ||
          word.start_s < previous || word.start_s < 0 || word.start_s > 36000) continue;
      previous = word.start_s;
      for (const [index, part] of word.word.replace(/\r/g, '').split('\n').entries()) {
        if (index) flush();
        if (part.trim() && start === undefined) start = word.start_s;
        text += part;
      }
    }
    flush();
    return lines.join('\n');
  }

  // Serialized by chrome.scripting: this function must be completely self-contained.
  async function fetchInPage(id) {
    if (location.origin !== 'https://suno.com' || !/^[0-9a-f-]{36}$/i.test(id)) return { status: 'invalid' };
    try {
      const cookie = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('__session='));
      const token = cookie ? decodeURIComponent(cookie.slice('__session='.length)) : await window.Clerk?.session?.getToken();
      if (!token) return { status: 'signin' };
      const response = await fetch('https://studio-api.prod.suno.com/api/gen/' + id + '/aligned_lyrics/v2/', {
        headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(12000)
      });
      if (response.status === 401) return { status: 'signin' };
      if (response.status === 403) return { status: 'blocked' };
      if (response.status === 429) {
        const value = response.headers.get('Retry-After');
        const seconds = Number(value);
        return { status: 'rate', retryMs: value && Number.isFinite(seconds) ? seconds * 1000 : Math.max(60000, Date.parse(value) - Date.now()) || 60000 };
      }
      if (response.status === 404) return { status: 'empty' };
      if (!response.ok) return { status: 'error' };
      const text = await response.text();
      if (text.length > 3000000) return { status: 'error' };
      const data = JSON.parse(text);
      return { status: 'ok', words: data.aligned_words };
    } catch { return { status: 'error' }; }
  }

  function createWorker({ folder, chrome, notify, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    let running;
    const messages = {
      tab: 'Open a Suno tab to finish importing lyrics.',
      signin: 'Sign in or refresh your Suno tab to import lyrics.',
      folder: 'Open your library to allow folder access for lyrics.',
      blocked: 'Suno blocked the lyrics request. Try again later.',
      error: 'Lyrics will retry automatically.',
      rate: 'Suno is busy. Lyrics will retry automatically.'
    };
    async function announce(status, force = false) {
      const key = 'sunoLyricsNotice';
      const last = (await chrome.storage.session.get(key))[key];
      if (force || !last || last.status !== status || now() - last.time > 3600000) {
        await chrome.storage.session.set({ [key]: { status, time: now() } });
        await notify({ type: 'imported:lyrics-notice', message: messages[status] });
      }
    }
    async function process(options) {
      const root = await folder.selection();
      if (!root || await root.handle.queryPermission({ mode: 'read' }) !== 'granted') return;
      const lists = await folder.scan(root);
      const groups = new Map();
      for (const list of lists) for (const song of list.songs) {
        const id = songID(song.sourceURL);
        if (!id || song.warning || song.lyrics?.trim()) continue;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push({ playlist: list.name, file: song.file });
      }
      if (!groups.size) return;
      if (await root.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        await announce('folder', options.force); return;
      }
      const key = 'sunoLyricsAttempts:' + root.id;
      const attempts = (await chrome.storage.local.get(key))[key] || {};
      if (options.retry) {
        const song = lists.find(list => list.name === options.retry.playlist)?.songs.find(song => song.file === options.retry.file);
        const id = songID(song?.sourceURL);
        if (id && attempts[id]?.reason !== 'rate') delete attempts[id];
      }
      const pending = [...groups].filter(([id]) => !(attempts[id]?.retryAt > now()));
      if (!pending.length) return;
      const tabs = (await chrome.tabs.query({ url: 'https://suno.com/*' })).filter(tab => !tab.discarded);
      if (!tabs.length) { await announce('tab', options.force); return; }
      let updated = 0, unavailable, testedTabs = tabs;
      for (const [id, tracks] of pending.slice(0, 6)) {
        let result;
        for (const tab of testedTabs) {
          try {
            const injection = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: fetchInPage, args: [id] });
            result = injection[0]?.result;
          } catch { result = { status: 'error' }; }
          if (result?.status === 'ok' || result?.status === 'empty' || result?.status === 'rate' || result?.status === 'blocked') {
            testedTabs = [tab]; break;
          }
        }
        if (!result || ['signin', 'blocked', 'error', 'rate', 'invalid'].includes(result.status)) {
          unavailable = result?.status === 'invalid' ? 'error' : result?.status || 'error';
          if (unavailable === 'rate') {
            const delay = Number.isFinite(result.retryMs) ? Math.max(60000, result.retryMs) : 60000;
            for (const [pendingID] of pending) attempts[pendingID] = { retryAt: now() + delay, reason: 'rate' };
          } else if (unavailable === 'blocked' || unavailable === 'error') {
            attempts[id] = { retryAt: now() + (unavailable === 'blocked' ? 1800000 : 300000), reason: unavailable };
          }
          break;
        }
        const lyrics = toLRC(result.words);
        if (!lyrics) attempts[id] = { retryAt: now() + 86400000, reason: 'empty' };
        else {
          for (const track of tracks) {
            if ((await folder.selection())?.id !== root.id) return;
            const written = await folder.update(root, track.playlist, track.file, { lyrics }, info =>
              songID(info.sourceURL) === id && !(typeof info.lyrics === 'string' && info.lyrics.trim()));
            if (written !== false) updated++;
          }
          delete attempts[id];
        }
        await pause(350);
      }
      // Keep retry bookkeeping bounded; successful lyrics live only in the shared sidecars.
      const bounded = Object.fromEntries(Object.entries(attempts).filter(([, value]) => value.retryAt > now()).slice(-500));
      await chrome.storage.local.set({ [key]: bounded });
      if (updated) {
        await chrome.storage.session.remove('sunoLyricsNotice');
        await notify({ type: 'imported:lyrics-updated', count: updated });
      }
      if (unavailable) await announce(unavailable, options.force);
    }
    function run(options = {}) {
      if (running && (options.force || options.retry)) return running.then(() => run(options));
      if (!running) running = process(options).catch(() => announce('error', options.force)).finally(() => { running = null; });
      return running;
    }
    return { run };
  }
  return { songID, toLRC, fetchInPage, createWorker };
})();
if (typeof module !== 'undefined') module.exports = SunoLyrics;
