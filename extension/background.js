/* A single writer prevents tabs and the popup from overwriting one another. */
importScripts('core.js', 'store.js', 'music-folder.js', 'suno-lyrics.js', 'imported-artwork.js');
const store = SpotifyFocusedStore.createStore(chrome.storage.local);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'spotify-focused:update') return;
  store.update(message.operation).then(
    (state) => respond({ ok: true, state }),
    () => respond({ ok: false })
  );
  return true;
});

const libraryURL = chrome.runtime.getURL('library.html');
const playerURL = chrome.runtime.getURL('local-player.html');
const lyricWorker = SunoLyrics.createWorker({
  folder: MusicFolder, chrome,
  notify: async message => {
    await Promise.all([
      chrome.runtime.sendMessage(message).catch(() => {}),
      spotifyTabs(message)
    ]);
  }
});
const lyricsAlarm = 'suno-lyrics-backfill';
chrome.alarms.get(lyricsAlarm).then(alarm => {
  if (!alarm) return chrome.alarms.create(lyricsAlarm, { periodInMinutes: 1 });
}).catch(() => {});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === lyricsAlarm) void lyricWorker.run(); });
chrome.runtime.onStartup.addListener(() => { void lyricWorker.run(); });
chrome.runtime.onInstalled.addListener(() => { void lyricWorker.run(); });
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.status === 'complete' && tab.url?.startsWith('https://suno.com/')) void lyricWorker.run();
});
let openingPlayer;
async function playerExists() {
  return (
    (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [playerURL] }))
      .length > 0
  );
}
async function ensurePlayer() {
  if (await playerExists()) return;
  openingPlayer ??= chrome.offscreen
    .createDocument({
      url: 'local-player.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play imported audio when the user navigates or closes the library.'
    })
    .finally(() => {
      openingPlayer = null;
    });
  await openingPlayer;
}
async function spotifyTabs(message) {
  const tabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})));
}
async function saveCachedPlayer(state) {
  if (state) {
    const { importedPlaybackOwner } = await chrome.storage.session.get('importedPlaybackOwner');
    state = {...state, playbackOwner:importedPlaybackOwner || state.playbackOwner || 'local'};
    await chrome.storage.session.set({ importedPlayer:state });
  } else await chrome.storage.session.remove('importedPlayer');
  await Promise.all([
    spotifyTabs({type:'imported:display',state}),
    chrome.runtime.sendMessage({type:'imported:state',state}).catch(()=>{})
  ]);
  return state;
}
async function control(cmd) {
  const exists = await playerExists();
  if (!exists && ['pause', 'clear'].includes(cmd.action)) {
    if (cmd.action === 'clear') {
      await saveCachedPlayer(null);
    }
    return {};
  }
  if (!exists && cmd.action !== 'play') {
    const { importedPlayer: last } = await chrome.storage.session.get('importedPlayer');
    if (!last?.entries?.length) return {};
    if (['enqueue', 'remove', 'reorder'].includes(cmd.action)) {
      const entries = [...last.entries];
      if (cmd.action === 'enqueue') entries.push(cmd.entry);
      else if (cmd.action === 'remove' && cmd.index > last.index && cmd.index < entries.length) entries.splice(cmd.index, 1);
      else if (cmd.action === 'reorder' && Number.isInteger(cmd.from) && Number.isInteger(cmd.to) && cmd.from > last.index && cmd.from < entries.length && cmd.to > last.index && cmd.to <= entries.length) {
        const [entry]=entries.splice(cmd.from,1);entries.splice(cmd.to-(cmd.from<cmd.to?1:0),0,entry);
      }
      const originalEntries = cmd.action === 'reorder' ? entries.slice() : cmd.action === 'enqueue'
        ? [...(last.originalEntries || last.entries),cmd.entry] : last.originalEntries;
      return saveCachedPlayer({ ...last, entries, originalEntries, playing:false });
    }
    if (['volume','seek','shuffle','repeat'].includes(cmd.action)) {
      const field = {volume:'volume',seek:'position',shuffle:'shuffle',repeat:'repeat'}[cmd.action];
      const value = cmd.action === 'shuffle' ? !last.shuffle : cmd.action === 'repeat'
        ? (!last.repeat || last.repeat === 'off' ? 'all' : last.repeat === 'all' ? 'one' : 'off') : cmd[field];
      const state = {
        ...last,
        playing: false,
        [field]: value
      };
      if (cmd.action === 'shuffle') {
        const next = last.entries.slice(last.index + 1);
        if (value) {
          for (let i=next.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1));[next[i],next[j]]=[next[j],next[i]]; }
          state.originalEntries = last.originalEntries || last.entries.slice();
        } else {
          const key = entry => entry.playlist+'\0'+entry.file;
          const original = last.originalEntries || last.entries;
          next.sort((a,b)=>original.findIndex(entry=>key(entry)===key(a))-original.findIndex(entry=>key(entry)===key(b)));
        }
        state.entries = [...last.entries.slice(0,last.index+1),...next];
      }
      return saveCachedPlayer(state);
    }
    let index = last.index;
    let position = last.position;
    if (cmd.action === 'next') { index = index + 1 < last.entries.length ? index + 1 : last.repeat === 'all' ? 0 : last.entries.length; position = 0; }
    if (cmd.action === 'previous') { index = last.position > 3 ? index : Math.max(0,index - 1); position = 0; }
    if (!last.entries[index]) return last;
    cmd = { ...last, index, position, restoreOrder: true, action: 'play' };
  }
  await ensurePlayer();
  const result = await chrome.runtime.sendMessage({ target: 'imported-player', cmd });
  if (!result?.ok) throw new Error(result?.error || 'The imported player is unavailable.');
  return result.state;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || typeof msg?.type !== 'string' || !msg.type.startsWith('imported:'))
    return;
  const fromPlayer = sender.url === playerURL;
  const fromLibrary = sender.url?.split(/[?#]/)[0] === libraryURL;
  const fromSpotify = sender.url?.startsWith('https://open.spotify.com/');
  async function handle() {
    if (msg.type === 'imported:open' && (fromSpotify || sender.url === chrome.runtime.getURL('popup.html'))) {
      if (fromSpotify && sender.tab?.id != null) {
        await chrome.storage.session.set({ ['importedOrigin:' + sender.tab.id]: sender.url });
        const hash = typeof msg.playlist === 'string' ? '#' + encodeURIComponent(msg.playlist) : '';
        // Keep Spotify in this tab's real history for normal browser Back and Forward.
        const params = new URLSearchParams({from:'spotify'});
        if (['lyrics','queue'].includes(msg.view)) params.set('view',msg.view);
        await chrome.tabs.update(sender.tab.id, { url: libraryURL + '?' + params + hash, active: true });
        return;
      }
      const [tab] = await chrome.tabs.query({ url: libraryURL + '*' });
      const hash = typeof msg.playlist === 'string' ? '#' + encodeURIComponent(msg.playlist)
        : msg.settings === true && tab ? new URL(tab.url).hash : '';
      const url = libraryURL + (msg.settings === true ? '?folder' : '') + hash;
      if (tab) {
        await chrome.tabs.update(tab.id, { url, active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else await chrome.tabs.create({ url });
    } else if (msg.type === 'imported:back' && fromLibrary) {
      if (sender.tab?.id != null && new URL(sender.url).searchParams.get('from') === 'spotify') {
        const key = 'importedOrigin:' + sender.tab.id;
        const origin = (await chrome.storage.session.get(key))[key];
        if (typeof origin === 'string' && origin.startsWith('https://open.spotify.com/')) {
          try { await chrome.tabs.goBack(sender.tab.id); }
          catch { await chrome.tabs.update(sender.tab.id, { url: origin, active: true }); }
          return;
        }
      }
      const { importedReturnTab } = await chrome.storage.session.get('importedReturnTab');
      const tabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
      const tab = tabs.find(tab => tab.id === importedReturnTab) || tabs[0];
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else await chrome.tabs.create({ url: 'https://open.spotify.com/home' });
    } else if (msg.type === 'imported:refresh' && (fromSpotify || fromLibrary)) {
      const root = await MusicFolder.selection();
      if (root && (await root.handle.queryPermission({ mode: 'read' })) === 'granted') {
        const key = 'importedHidden:' + root.id;
        const saved = await chrome.storage.local.get([key, 'importedHome']);
        const next = await MusicFolder.home(root, saved[key], saved.importedHome);
        if (JSON.stringify(next) !== JSON.stringify(saved.importedHome))
          await chrome.storage.local.set({ importedHome: next });
      }
      void lyricWorker.run();
    } else if (msg.type === 'imported:lyrics-retry' && fromLibrary) {
      void lyricWorker.run({ force: true, retry: { playlist: msg.playlist, file: msg.file } });
    } else if (msg.type === 'imported:lyrics-start' && fromLibrary) {
      void lyricWorker.run({ force: true });
    } else if (msg.type === 'imported:started' && fromPlayer) {
      await chrome.storage.session.set({ importedPlaybackOwner: 'local' });
      await spotifyTabs({ type: 'imported:pauseSpotify' });
    } else if (msg.type === 'imported:spotify-started' && fromSpotify) {
      await chrome.storage.session.set({ importedPlaybackOwner: 'spotify' });
      await control({ action: 'pause' });
      await spotifyTabs({ type: 'imported:owner', owner: 'spotify' });
    } else if (msg.type === 'imported:state' && fromPlayer) {
      const { importedPlaybackOwner } = await chrome.storage.session.get('importedPlaybackOwner');
      const state = { ...msg.state, playbackOwner: importedPlaybackOwner || 'local' };
      await chrome.storage.session.set({ importedPlayer: state });
      await spotifyTabs({ type: 'imported:display', state });
    } else if (msg.type === 'imported:progress' && fromPlayer) {
      await spotifyTabs(msg);
    } else if (msg.type === 'imported:error' && fromPlayer) {
      await spotifyTabs(msg);
    } else if (msg.type === 'imported:status' && (fromLibrary || fromSpotify)) {
      const { importedPlayer, importedPlaybackOwner } = await chrome.storage.session.get(['importedPlayer', 'importedPlaybackOwner']);
      return importedPlayer ? { ...importedPlayer, playbackOwner: importedPlaybackOwner || 'local' } : importedPlayer;
    } else if (
      msg.type === 'imported:command' &&
      (fromLibrary || (fromSpotify && ['pause', 'resume', 'previous', 'next', 'seek', 'volume', 'shuffle', 'repeat'].includes(msg.cmd?.action)))
    ) {
      return control(msg.cmd);
    } else return;
  }
  handle().then(
    (state) => reply({ ok: true, state }),
    (error) => reply({ ok: false, error: error.message })
  );
  return true;
});
