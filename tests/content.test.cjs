const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const C = require('../extension/core.js');
const { createStore } = require('../extension/store.js');
const a = 'a'.repeat(22), b = 'b'.repeat(22);
const row = (id, name) => `<div role="row"><div role="gridcell"><div role="button" aria-labelledby="listrow-title-spotify:playlist:${id}"></div><p id="listrow-title-spotify:playlist:${id}">${name}</p><p data-encore-id="listRowSubtitle">Playlist • Listener</p><img src="https://i.scdn.co/image/${id}"></div></div>`;
const playlist = (name = 'End of 2026') => `<section data-testid="playlist-page"><div data-testid="entity-header"><span data-testid="entityTitle"><h1>${name}</h1></span><a data-testid="creator-link">Listener</a><div data-testid="playlist-image"><img src="https://i.scdn.co/image/${name.replaceAll(' ', '')}"></div></div><div data-testid="action-bar-row"><button id="native-play">Play</button></div><div data-testid="playlist-tracklist">Native songs</div></section>`;

async function fixture(t, { saved, path = '/home', failSet = false, storageDelay = 0, shared, beforeStart } = {}) {
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
  Object.defineProperty(window, 'crypto', {value: require('node:crypto').webcrypto});
  window.TextEncoder = TextEncoder;
  window.chrome = {
    storage: {
      local: {
        async get() { return structuredClone(data); },
        async set(update) {
          if (storageDelay) await new Promise(resolve => setTimeout(resolve, storageDelay));
          if (failSet) throw Error('quota');
          const changes = Object.fromEntries(Object.entries(update).map(([key, newValue]) => [key, { oldValue: data[key], newValue }]));
          Object.assign(data, structuredClone(update));
          writes.push(structuredClone(update));
          for (const listener of listeners) listener(changes, 'local');
        }
      },
      onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
    }
  };
  const store = shared?.store || createStore(window.chrome.storage.local);
  if (shared) shared.store = store;
  window.chrome.runtime = { id: 'test-extension', async sendMessage(message) {
    try { return { ok: true, state: await store.update(message.operation) }; }
    catch { return { ok: false }; }
  } };
  const chip = window.document.querySelector('[aria-label="Playlists"]');
  chip.parentElement.addEventListener('click', () => chip.setAttribute('aria-checked', 'true'));
  beforeStart?.(window);
  for (const file of ['core.js', 'control-icons.js', 'imported-artwork.js', 'imported-player-view.js', 'content.js']) window.eval(readFileSync(`extension/${file}`, 'utf8'));
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
  assert.match(f.doc.querySelector('.sf-status').textContent, /could not be saved/);
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
  assert.match(f.doc.querySelector('.sf-status').textContent, /could not be saved/);
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

test('drawer defaults to By you after filters load, then respects switching back to Playlists', async t => {
  const f = await fixture(t);
  const playlists = f.doc.querySelector('[aria-label="Playlists"]');
  f.doc.querySelector('.sf-all').click();
  const option = f.doc.createElement('div');
  option.setAttribute('role', 'option');
  option.innerHTML = '<div data-encore-id="chip" aria-label="By you" aria-checked="false"></div>';
  const byYou = option.firstElementChild;
  option.addEventListener('click', () => byYou.setAttribute('aria-checked', String(byYou.getAttribute('aria-checked') !== 'true')));
  playlists.parentElement.after(option);
  f.window.__spotifyFocused.refresh();
  assert.equal(byYou.getAttribute('aria-checked'), 'true');
  playlists.parentElement.addEventListener('click', () => playlists.setAttribute('aria-checked', 'false'));
  playlists.click();
  f.window.__spotifyFocused.refresh();
  assert.equal(byYou.getAttribute('aria-checked'), 'false');
  assert.equal(playlists.getAttribute('aria-checked'), 'true');
  f.doc.querySelector('.sf-close').click();
  f.doc.querySelector('.sf-all').click();
  assert.equal(byYou.getAttribute('aria-checked'), 'true');
});

test('playlist discovery sections remain available', async t => {
  const f = await fixture(t, { path: '/playlist/' + a });
  const recommendations = f.doc.createElement('section');
  recommendations.innerHTML = '<h2>Recommended songs</h2><div data-testid="recommended-track">Discover a song</div>';
  f.doc.querySelector('[data-testid="playlist-page"]').append(recommendations);
  f.window.__spotifyFocused.refresh();
  assert.equal(recommendations.hasAttribute('data-sf-recommendation'), false);
  assert.equal(f.doc.querySelector('.sf-show-home').title, 'Show on Home');
  assert.equal(f.doc.querySelector('.sf-library-pin').getAttribute('data-sf-tooltip'), 'Show on Home');
});

test('document-start cleanup waits for the body and staged Spotify layout', async t => {
  let body;
  const f = await fixture(t, { beforeStart(window) { body = window.document.body; body.remove(); } });
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-clean'), true);
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-loading'), true);
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
  f.doc.documentElement.append(body);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), true);
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-loading'), false);
  assert.equal(f.doc.querySelectorAll('.sf-home').length, 1);
});

test('late app-download popovers and menu items are hidden while music and editing remain available', async t => {
  const f = await fixture(t);
  const portal = f.doc.createElement('div');
  portal.innerHTML = '<div role="tooltip">Download and play offline with the Mac app<button>Download the free app</button></div><div role="menuitem">Download for Mac</div><div role="dialog">Edit playlist<button>Save</button></div><button>Play Download by Artist</button>';
  f.doc.body.append(portal);
  await f.flush();
  assert.equal(portal.querySelector('[role="tooltip"]').hasAttribute('data-sf-app-promo'), true);
  assert.equal(portal.querySelector('[role="menuitem"]').hasAttribute('data-sf-app-promo'), true);
  assert.equal(portal.querySelector('[role="dialog"]').hasAttribute('data-sf-app-promo'), false);
  assert.equal(portal.lastElementChild.hasAttribute('data-sf-app-promo'), false);
  const item = portal.querySelector('[role="menuitem"]');
  item.textContent = 'Add to playlist';
  await f.flush();
  assert.equal(item.hasAttribute('data-sf-app-promo'), false);
  await f.change({ ...f.saved, enabled: false });
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-clean'), false);
});

test('cleanup stays active during a temporary Spotify layout replacement', async t => {
  const f = await fixture(t);
  const libraryContent = f.doc.querySelector('.YourLibraryX');
  const parent = libraryContent.parentElement;
  libraryContent.remove();
  f.window.__spotifyFocused.refresh();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-clean'), true);
  parent.append(libraryContent);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), true);
});

test('a saved disabled preference releases startup concealment', async t => {
  const f = await fixture(t, { saved: { enabled: false } });
  for (const attribute of ['data-sf-clean', 'data-sf-loading', 'data-sf-enabled']) {
    assert.equal(f.doc.documentElement.hasAttribute(attribute), false);
  }
});

test('startup concealment expires if Spotify never renders a supported layout', async t => {
  const f = await fixture(t, { beforeStart(window) { window.document.body.innerHTML = '<div data-testid="root">Sign in to Spotify</div>'; } });
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-loading'), true);
  await new Promise(resolve => setTimeout(resolve, 4050));
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-loading'), false);
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
  assert.equal(f.doc.querySelector('[data-testid="root"]').textContent, 'Sign in to Spotify');
});

test('sidebar allows selected Queue and Connect panels, never app-download or loading panels', async t => {
  const f = await fixture(t);
  const right = f.doc.querySelector('[data-sf-right]');
  const player = f.doc.querySelector('[data-testid="now-playing-bar"]');
  player.insertAdjacentHTML('beforeend', '<button data-testid="control-button-queue" aria-pressed="false">Queue</button><button aria-label="Connect to a device" aria-pressed="false">Connect</button>');
  const queue = player.querySelector('[data-testid="control-button-queue"]');
  const connect = player.querySelector('[aria-label="Connect to a device"]');
  right.innerHTML = '<div>Download Spotify for Mac</div>';
  f.window.__spotifyFocused.refresh();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-right-open'), false);
  queue.setAttribute('aria-pressed', 'true');
  await f.flush();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-right-open'), false);
  right.innerHTML = '<aside aria-label="Queue">Queued songs</aside>';
  await f.flush();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-right-open'), true);
  right.innerHTML = '<div>Download Spotify for Mac</div>';
  await f.flush();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-right-open'), false);
  queue.setAttribute('aria-pressed', 'false');
  connect.setAttribute('aria-pressed', 'true');
  right.innerHTML = '<aside aria-label="Connect to a device">Devices</aside>';
  await f.flush();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-right-open'), true);
  connect.setAttribute('aria-pressed', 'false');
  await f.flush();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-right-open'), false);
});

test('playlist names cannot classify the library drawer as an app promotion', async t => {
  const f = await fixture(t);
  f.doc.querySelector('[id^="listrow-title-"]').textContent = 'Music Download for Mac today';
  f.doc.querySelector('.sf-all').click();
  await f.flush();
  assert.equal(f.doc.querySelector('[data-sf-library]').hasAttribute('data-sf-app-promo'), false);
  assert.equal(f.doc.querySelector('[data-sf-library]').getAttribute('role'), 'dialog');
  assert.ok(f.doc.querySelector('.sf-close'));
});

test('imported playlists appear below End of 2026 and open the extension library', async t => {
  const f = await fixture(t);
  const opened = [];
  f.window.chrome.runtime.sendMessage = async msg => { opened.push(msg); return { ok: true }; };
  await f.window.chrome.storage.local.set({ importedHome: [{ name: 'Suno', count: 2 }] });
  const rows = [...f.doc.querySelectorAll('.sf-home-row')];
  assert.match(rows[0].textContent, /End of 2026/);
  assert.match(rows[1].textContent, /Suno.*2 songs/);
  rows[1].querySelector('button').click();
  assert.deepEqual(JSON.parse(JSON.stringify(opened.at(-1))), { type: 'imported:open', playlist: 'Suno' });
  await f.window.chrome.storage.local.set({ importedHome: [] });
  assert.equal(f.doc.querySelector('.sf-import-link'), null);
});

test('reloading the extension stops stale polling and restores native Spotify without errors', async t => {
  const f = await fixture(t);
  const errors = [];
  f.window.addEventListener('error', event => errors.push(event.error));
  f.window.chrome.runtime.id = undefined;
  Object.defineProperty(f.window.chrome.runtime, 'onMessage', { get() { throw Error('Extension context invalidated.'); } });
  f.window.chrome.storage.onChanged.removeListener = () => { throw Error('Extension context invalidated.'); };
  await new Promise(resolve => setTimeout(resolve, 420));
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
  assert.ok(f.doc.querySelector('[data-testid="now-playing-bar"]'));
  assert.equal(f.doc.querySelectorAll('[data-sf-ui]').length, 0);
  assert.equal(errors.length, 0);
});

test('storage callbacks after invalidation do not render stale imported playlists', async t => {
  const f = await fixture(t);
  f.window.chrome.runtime.id = undefined;
  await f.window.chrome.storage.local.set({ importedHome: [{name:'Suno',count:2}] });
  assert.equal(f.doc.querySelector('.sf-import-link'), null);
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
});

test('a synchronous messaging invalidation is caught even when runtime.id has not changed yet', async t => {
  const f = await fixture(t);
  await f.window.chrome.storage.local.set({ importedHome: [{name:'Suno',count:2}] });
  f.window.chrome.runtime.sendMessage = () => { throw Error('Extension context invalidated.'); };
  f.doc.querySelector('.sf-import-link').click();
  await f.flush();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-enabled'), false);
  assert.equal(f.doc.querySelectorAll('[data-sf-ui]').length, 0);
});

test('Space controls imported audio without triggering Spotify or intercepting typing', async t => {
  let receive;
  const f = await fixture(t, {beforeStart(window) {
    window.chrome.runtime.onMessage = {addListener: fn => { receive=fn; },removeListener() {}};
  }});
  const commands=[];
  f.window.chrome.runtime.sendMessage = async msg => { commands.push(msg); return {ok:true}; };
  receive({type:'imported:display',state:{index:0,playing:true,entries:[{title:'Song',artist:'Suno',playlist:'Suno',file:'song.m4a'}]}});
  let nativeKeys=0;
  f.doc.addEventListener('keydown',()=>nativeKeys++);
  const press=(target,options={})=>{const event=new f.window.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
  assert.equal(press(f.doc.body).defaultPrevented,true);
  await f.flush();
  assert.equal(commands.at(-1).cmd.action,'pause');assert.equal(nativeKeys,0);
  press(f.doc.body,{repeat:true});
  const count=commands.length;
  assert.equal(press(f.doc.querySelector('input')).defaultPrevented,false);
  await f.flush();assert.equal(commands.length,count);assert.equal(nativeKeys,1);
});

test('starting Spotify restores its player even when the imported queue is paused', async t => {
  let receive;
  const f=await fixture(t,{beforeStart(window){window.chrome.runtime.onMessage={addListener:fn=>{receive=fn;},removeListener(){}};}});
  const messages=[];
  f.window.chrome.runtime.sendMessage=async message=>{messages.push(message);return {ok:true};};
  const local={index:0,playing:false,entries:[{title:'Song',artist:'Suno',playlist:'Suno',file:'song.m4a'}]};
  receive({type:'imported:display',state:local});
  assert.ok(f.doc.querySelector('.sf-local-bar'));
  f.doc.querySelector('[data-testid="now-playing-bar"]').insertAdjacentHTML('beforeend','<button data-testid="control-button-playpause" aria-label="Play">Play</button>');
  f.doc.querySelector('[data-testid="control-button-playpause"]').setAttribute('aria-label','Pause');
  await f.flush();
  assert.equal(f.doc.documentElement.hasAttribute('data-sf-local-player'),false);
  assert.equal(f.doc.querySelector('.sf-local-bar'),null);
  assert.ok(messages.some(message=>message.type==='imported:spotify-started'));
  receive({type:'imported:display',state:local});
  assert.equal(f.doc.querySelector('.sf-local-bar'),null);
  receive({type:'imported:pauseSpotify'});
  assert.ok(f.doc.querySelector('.sf-local-bar'));
});

test('Spotify playback ownership reaches sibling tabs and survives cached queue updates', async t => {
  let receive;
  const f=await fixture(t,{beforeStart(window){window.chrome.runtime.onMessage={addListener:fn=>{receive=fn;},removeListener(){}};}});
  const state={index:0,playing:false,entries:[{title:'Song',artist:'Suno',playlist:'Suno',file:'song.m4a'}]};
  receive({type:'imported:display',state});
  receive({type:'imported:owner',owner:'spotify'});
  receive({type:'imported:display',state:{...state,playbackOwner:'spotify'}});
  assert.equal(f.doc.querySelector('.sf-local-bar'),null);
});
