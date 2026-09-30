const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const C = require('../extension/core.js');
const { createStore } = require('../extension/store.js');
const a = 'a'.repeat(22), b = 'b'.repeat(22);
const row = (id, name) => `<div role="row"><div role="gridcell"><div role="button" aria-labelledby="listrow-title-spotify:playlist:${id}"></div><p id="listrow-title-spotify:playlist:${id}">${name}</p><p data-encore-id="listRowSubtitle">Playlist • Listener</p><img src="https://i.scdn.co/image/${id}"></div></div>`;
const playlist = (name = 'End of 2026') => `<section data-testid="playlist-page"><div data-testid="entity-header"><span data-testid="entityTitle"><h1>${name}</h1></span><a data-testid="creator-link">Listener</a><div data-testid="playlist-image"><img src="https://i.scdn.co/image/${name.replaceAll(' ', '')}"></div></div><div data-testid="action-bar-row"><button id="native-play">Play</button></div><div data-testid="playlist-tracklist">Native songs</div></section>`;

async function fixture(t, { saved, path = '/home', failSet = false, storageDelay = 0, shared } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="layout">
    <div data-testid="global-nav-bar" style="grid-area:global-nav"><div><input data-testid="search-input" type="search" aria-controls="search-suggestions"></div><div><button data-testid="user-widget-link">Account</button></div></div>
    <div style="grid-area:left-sidebar"><nav aria-label="Main"><div class="YourLibraryX"><div role="option"><div data-encore-id="chip" aria-label="Playlists" aria-checked="false"></div></div><div role="grid">${row(a, 'End of 2026')}${row(b, 'Other playlist')}</div></div></nav></div>
    <div style="grid-area:main-view"><div class="main-view-container"><main>${path.includes('/playlist/') ? playlist() : '<h1>Recommendations</h1>'}</main></div></div>
    <div style="grid-area:now-playing-bar"><aside data-testid="now-playing-bar"><button>Native playback</button></aside></div>
    <div style="grid-area:right-sidebar"><div data-testid="NPV_Panel_OpenDiv">Automatic suggestions</div></div>
    </div><div id="search-suggestions" role="listbox">Recent searches</div></body></html>`, { url: `https://open.spotify.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const listeners = shared?.listeners || new Set();
  let data = shared?.data || (saved ? { [C.STORAGE_KEY]: saved } : {});
  const writes = shared?.writes || [];
  window.structuredClone = structuredClone;
  window.chrome = {
    storage: {
      local: {
        async get() { return structuredClone(data); },
        async set(update) {
          if (storageDelay) await new Promise(resolve => setTimeout(resolve, storageDelay));
          if (failSet) throw Error('quota');
          const oldValue = data[C.STORAGE_KEY];
          Object.assign(data, structuredClone(update));
          writes.push(structuredClone(update));
          for (const listener of listeners) listener({ [C.STORAGE_KEY]: { oldValue, newValue: data[C.STORAGE_KEY] } }, 'local');
        }
      },
      onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
    }
  };
  const store = shared?.store || createStore(window.chrome.storage.local);
  if (shared) shared.store = store;
  window.chrome.runtime = { async sendMessage(message) {
    try { return { ok: true, state: await store.update(message.operation) }; }
    catch { return { ok: false }; }
  } };
  const chip = window.document.querySelector('[aria-label="Playlists"]');
  chip.parentElement.addEventListener('click', () => chip.setAttribute('aria-checked', 'true'));
  for (const file of ['core.js', 'content.js']) window.eval(readFileSync(`extension/${file}`, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 10));
  t.after(() => { window.__spotifyFocused.dispose(); window.close(); });
  return { window, doc: window.document, writes, async flush() { await new Promise(resolve => setTimeout(resolve, 10)); }, get saved() { return data[C.STORAGE_KEY]; }, failWrites() { failSet = true; }, async change(state) { await window.chrome.storage.local.set({ [C.STORAGE_KEY]: { ...state, revision: (data[C.STORAGE_KEY]?.revision || 0) + 1 } }); } };
}

test('starts with End of 2026, preserves real playback nodes, and keeps other playlists behind a click', async t => {
  const f = await fixture(t);
  assert.ok(f.doc.documentElement.hasAttribute('data-sf-enabled'));
  assert.deepEqual(f.saved.home.map(p => p.name), ['End of 2026']);
  assert.equal(f.doc.querySelectorAll('.sf-home-row').length, 1);
  assert.ok(f.doc.querySelector('[data-testid="now-playing-bar"]'));
  assert.equal(f.doc.querySelector('[data-sf-library]').inert, true);
  f.doc.querySelector('.sf-all').click();
  assert.equal(f.doc.querySelector('[data-sf-library]').inert, false);
  assert.equal(f.doc.querySelector('[aria-label="Playlists"]').getAttribute('aria-checked'), 'true');
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-library-open'), true);
});

test('pinning does not activate native rows and survives a reload; removing the default does not re-add it', async t => {
  const f = await fixture(t);
  const rowB = f.doc.querySelector(`[id="listrow-title-spotify:playlist:${b}"]`).closest('[role="row"]');
  let nativeClicks = 0;
  rowB.addEventListener('click', () => nativeClicks++);
  rowB.querySelector('.sf-library-pin').click();
  await f.flush();
  assert.equal(nativeClicks, 0);
  assert.deepEqual(f.saved.home.map(p => p.id), [a, b]);
  f.doc.querySelector('.sf-home-row input').click();
  await f.flush();
  f.window.__spotifyFocused.refresh();
  assert.deepEqual(f.saved.home.map(p => p.id), [b]);
  const reload = await fixture(t, { saved: f.saved });
  assert.deepEqual([...reload.doc.querySelectorAll('.sf-home-row strong')].map(e => e.textContent), ['Other playlist']);
});

test('virtualized library rows rebind pins and remove controls for non-playlists', async t => {
  const f = await fixture(t);
  const first = f.doc.querySelector('.YourLibraryX [role="row"]');
  first.innerHTML = `<div role="gridcell"><p id="listrow-title-spotify:playlist:${'c'.repeat(22)}">Recycled playlist</p></div>`;
  f.window.__spotifyFocused.refresh();
  first.querySelector('.sf-library-pin').click();
  await f.flush();
  assert.equal(f.saved.home.at(-1).name, 'Recycled playlist');
  first.querySelector('p').id = 'listrow-title-spotify:album:' + a;
  f.window.__spotifyFocused.refresh();
  assert.equal(first.querySelector('.sf-library-pin'), null);
  assert.equal(first.hasAttribute('data-sf-playlist-row'), false);
});

test('filtered library rows retain owners when Spotify removes the Playlist prefix', async t => {
  const f = await fixture(t);
  const rowB = f.doc.querySelector(`[id="listrow-title-spotify:playlist:${b}"]`).closest('[role="row"]');
  rowB.querySelector('[data-encore-id="listRowSubtitle"]').textContent = 'Listener';
  rowB.querySelector('.sf-library-pin').click();
  await f.flush();
  assert.equal(f.saved.home.find(p => p.id === b).owner, 'Listener');
});

test('empty search is quiet while typed search uses native results and controls', async t => {
  const f = await fixture(t, { path: '/search' });
  assert.equal(f.doc.documentElement.getAttribute('data-sf-page'), 'search-empty');
  const input = f.doc.querySelector('[data-testid="search-input"]');
  assert.ok(f.doc.getElementById('search-suggestions').hasAttribute('data-sf-search-popup'));
  assert.ok(f.doc.documentElement.hasAttribute('data-sf-search-empty'));
  input.value = 'podcast';
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-search-empty'), false);
  f.window.history.pushState({}, '', '/search/podcast');
  f.window.__spotifyFocused.refresh();
  assert.equal(f.doc.documentElement.getAttribute('data-sf-page'), 'content');
});

test('navigation keeps the existing player mounted and records usable browser history', async t => {
  const f = await fixture(t);
  const player = f.doc.querySelector('[data-testid="now-playing-bar"]');
  let pops = 0;
  f.window.addEventListener('popstate', () => pops++);
  f.doc.querySelector('.sf-playlist-link').click();
  assert.equal(f.window.location.pathname, '/playlist/' + a);
  assert.equal(f.window.history.state.idx, 1);
  assert.equal(pops, 1);
  assert.equal(f.doc.querySelector('[data-testid="now-playing-bar"]'), player);
});

test('playlist control saves the actual playlist and rejects a stale header during navigation', async t => {
  const f = await fixture(t, { path: '/playlist/' + a });
  const native = f.doc.getElementById('native-play');
  assert.equal(f.doc.querySelector('.sf-show-home input').checked, true);
  f.doc.querySelector('.sf-show-home input').click();
  await f.flush();
  assert.equal(f.saved.home.length, 0);
  assert.equal(f.doc.getElementById('native-play'), native);
  f.window.history.pushState({}, '', '/playlist/' + b);
  f.window.__spotifyFocused.refresh();
  assert.equal(f.doc.querySelector('.sf-show-home'), null);
  f.doc.querySelector('[data-testid="entityTitle"] h1').textContent = 'New playlist';
  f.window.__spotifyFocused.refresh();
  f.doc.querySelector('.sf-show-home input').click();
  await f.flush();
  assert.equal(f.saved.home[0].id, b);
  assert.equal(f.saved.home[0].name, 'New playlist');
});

test('switching off restores Spotify and switching on mounts only one set of controls', async t => {
  const f = await fixture(t);
  const originalPlayer = f.doc.querySelector('[data-testid="now-playing-bar"]');
  await f.change({ ...f.saved, enabled: false });
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
  assert.equal(f.doc.querySelectorAll('[data-sf-ui]').length, 0);
  assert.equal(f.doc.querySelector('[data-sf-library]').inert, false);
  await f.change({ ...f.saved, enabled: true });
  f.window.__spotifyFocused.refresh();
  assert.equal(f.doc.querySelectorAll('.sf-home').length, 1);
  assert.equal(f.doc.querySelectorAll('.sf-brand').length, 1);
  assert.equal(f.doc.querySelector('[data-testid="now-playing-bar"]'), originalPlayer);
});

test('playlist names are rendered as text, never executable markup', async t => {
  const f = await fixture(t, { saved: { home: [{ id: 'z'.repeat(22), name: '<img src=x onerror=alert(1)>', image: 'https://evil.example/pixel' }], didChooseHome: true } });
  assert.equal(f.doc.querySelector('.sf-home-row strong').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(f.doc.querySelector('.sf-home-row strong img'), null);
  assert.equal(f.doc.querySelector('.sf-home-row img'), null);
});

test('storage errors are reported instead of silently losing Home choices', async t => {
  const f = await fixture(t, { failSet: true });
  await f.flush();
  assert.match(f.doc.querySelector('[role="status"]').textContent, /could not be saved/);
});

test('unknown Spotify structure leaves native content visible', async t => {
  const f = await fixture(t);
  f.doc.querySelector('.main-view-container').remove();
  f.window.__spotifyFocused.refresh();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
  assert.equal(f.doc.querySelectorAll('[data-sf-ui]').length, 0);
  assert.equal(f.doc.querySelector('[data-sf-library]').inert, false);
});

test('navigation after disabling does not make the native library inert again', async t => {
  const f = await fixture(t);
  await f.change({ ...f.saved, enabled: false });
  f.window.history.pushState({}, '', '/search/clairo');
  await new Promise(resolve => setTimeout(resolve, 380));
  assert.equal(f.doc.querySelector('[data-sf-library]').inert, false);
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
});

test('different playlists with identical artwork and title work after Spotify replaces the page', async t => {
  const f = await fixture(t, { path: '/playlist/' + a });
  f.window.history.pushState({}, '', '/playlist/' + b);
  f.doc.querySelector('main').innerHTML = playlist();
  f.window.__spotifyFocused.refresh();
  assert.ok(f.doc.querySelector('.sf-show-home'));
  f.doc.querySelector('.sf-show-home input').click();
  await f.flush();
  assert.ok(f.saved.home.some(p => p.id === b));
});

test('save failures remain visible after switching off and on', async t => {
  const f = await fixture(t);
  await f.change({ ...f.saved, enabled: false });
  await f.change({ ...f.saved, enabled: true });
  f.failWrites();
  f.doc.querySelector('.sf-home-row input').click();
  await f.flush();
  assert.match(f.doc.querySelector('[role="status"]').textContent, /could not be saved/);
});

test('late storage events do not erase newer pending Home selections', async t => {
  const f = await fixture(t, { saved: { home: [], didChooseHome: true }, storageDelay: 60 });
  const pins = () => f.doc.querySelectorAll('.sf-library-pin');
  pins()[0].click();
  pins()[1].click();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(f.doc.querySelectorAll('.sf-home-row').length, 2);
  pins()[0].click();
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.deepEqual(f.saved.home.map(p => p.id), [b]);
  assert.deepEqual([...f.doc.querySelectorAll('.sf-home-row strong')].map(e => e.textContent), ['Other playlist']);
});

test('two tabs with different artwork stop writing when Spotify metadata is unchanged', async t => {
  const shared = { listeners: new Set(), data: { [C.STORAGE_KEY]: C.settings({ home: [{ id: a, name: 'End of 2026' }] }) }, writes: [] };
  await fixture(t, { path: '/playlist/' + a, shared });
  await fixture(t, { path: '/home', shared });
  await new Promise(resolve => setTimeout(resolve, 950));
  const settledWrites = shared.writes.length;
  assert.ok(settledWrites > 0);
  assert.equal(shared.data[C.STORAGE_KEY].home[0].image, 'https://i.scdn.co/image/Endof2026');
  await new Promise(resolve => setTimeout(resolve, 950));
  assert.equal(shared.writes.length, settledWrites);
});
