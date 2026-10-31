const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

function fixture(tabs, stored = {}) {
  const listeners = [], calls = [], commands = [], broadcasts = [], values = { ...stored };
  const chrome = {
    runtime: { id: 'extension', getURL: path => 'chrome-extension://extension/' + path,
      getContexts: async () => [], sendMessage: async message => {
        if (message.target === 'imported-player') commands.push(message.cmd); else broadcasts.push(message);
        return {ok:true,state:message.cmd};
      },
      onMessage: { addListener: fn => listeners.push(fn) }, onStartup: {addListener(){}}, onInstalled: {addListener(){}} },
    storage: { local: {}, session: { get: async () => values, set: async data => Object.assign(values, data) } },
    alarms: {get:async()=>({}), onAlarm:{addListener(){}}},
    offscreen: {createDocument:async()=>{}},
    tabs: {
      onUpdated:{addListener(){}},
      sendMessage:async (id,message)=>calls.push(['message',id,message]),
      goBack: async id => calls.push(['goBack', id]),
      query: async query => tabs.filter(tab => query.url.includes('open.spotify.com')
        ? tab.url.startsWith('https://open.spotify.com/') : tab.url.startsWith('chrome-extension://extension/library.html')),
      update: async (...args) => calls.push(['update', ...args]),
      create: async args => calls.push(['create', args])
    },
    windows: { update: async (...args) => calls.push(['window', ...args]) }
  };
  runInNewContext(readFileSync('extension/background.js', 'utf8'), {
    chrome, URL, URLSearchParams, importScripts() {}, MusicFolder: {}, SunoLyrics: {createWorker:()=>({run:async()=>{}})}, SpotifyFocusedStore: { createStore: () => ({}) }
  });
  return { calls, commands, broadcasts, values, send: (message, sender) => new Promise(resolve => listeners[1](message, { id: 'extension', ...sender }, resolve)) };
}

test('Back returns to the originating Spotify tab and focuses its window', async () => {
  const f = fixture([{ id: 8, windowId: 2, url: 'https://open.spotify.com/playlist/example' }], { importedReturnTab: 8 });
  const result = await f.send({type:'imported:back'}, {url:'chrome-extension://extension/library.html?folder#Suno'});
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls.map(x => x[0]), ['update', 'window']);
  assert.equal(f.calls[0][1], 8);
  assert.equal(f.calls[1][1], 2);
});

test('Back reuses another Spotify tab or opens Home if the original tab is gone', async () => {
  const f = fixture([{id: 9, windowId: 3, url:'https://open.spotify.com/home'}], {importedReturnTab: 8});
  await f.send({type:'imported:back'}, {url:'chrome-extension://extension/library.html'});
  assert.equal(f.calls[0][1], 9);
  const empty = fixture([]);
  await empty.send({type:'imported:back'}, {url:'chrome-extension://extension/library.html'});
  assert.equal(empty.calls[0][0], 'create');
  assert.equal(empty.calls[0][1].url, 'https://open.spotify.com/home');
});

test('Folder settings reuse the existing library tab, including one with a query string', async () => {
  const f = fixture([{id:4,windowId:2,url:'chrome-extension://extension/library.html?segtest#Suno'}]);
  await f.send({type:'imported:open',settings:true}, {url:'chrome-extension://extension/popup.html'});
  assert.equal(f.calls[0][0], 'update');
  assert.equal(f.calls[0][1], 4);
  assert.equal(f.calls[0][2].url, 'chrome-extension://extension/library.html?folder#Suno');
});

test('Opening a playlist remembers its Spotify origin; Spotify cannot invoke the library-only Back action', async () => {
  const f = fixture([]);
  await f.send({type:'imported:open',playlist:'My music'}, {url:'https://open.spotify.com/home',tab:{id:12}});
  assert.equal(f.values['importedOrigin:12'], 'https://open.spotify.com/home');
  assert.equal(f.calls[0][0], 'update');
  assert.equal(f.calls[0][1], 12);
  assert.equal(f.calls[0][2].url, 'chrome-extension://extension/library.html?from=spotify#My%20music');
  f.calls.length = 0;
  await f.send({type:'imported:back'}, {url:'https://open.spotify.com/home'});
  assert.equal(f.calls.length, 0);
});

test('opening Suno navigates the originating Spotify tab even if another library tab exists', async () => {
  const f=fixture([{id:9,windowId:2,url:'chrome-extension://extension/library.html#Other'}]);
  await f.send({type:'imported:open',playlist:'Suno'}, {url:'https://open.spotify.com/playlist/original',tab:{id:12}});
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][0],'update');assert.equal(f.calls[0][1],12);
  assert.equal(f.calls[0][2].url,'chrome-extension://extension/library.html?from=spotify#Suno');
  assert.equal(f.values['importedOrigin:12'],'https://open.spotify.com/playlist/original');
});

test('the library Back button uses the same tab history as browser Back', async () => {
  const f=fixture([], {'importedOrigin:12':'https://open.spotify.com/playlist/original'});
  await f.send({type:'imported:back'}, {url:'chrome-extension://extension/library.html?from=spotify#Suno',tab:{id:12}});
  assert.deepEqual(f.calls,[['goBack',12]]);
});

test('cached controls preserve Previous and Repeat behavior after the audio document closes', async () => {
  const entries=['one','two','three'].map(file=>({file,playlist:'Suno'}));
  const cached={entries,index:1,position:42,repeat:'all',shuffle:true,sourceID:'test'};
  const f=fixture([],{importedPlayer:cached});
  const sender={url:'chrome-extension://extension/library.html'};
  await f.send({type:'imported:command',cmd:{action:'previous'}},sender);
  assert.equal(f.commands[0].index,1);assert.equal(f.commands[0].position,0);assert.equal(f.commands[0].restoreOrder,true);
  f.values.importedPlayer={...cached,index:2};
  await f.send({type:'imported:command',cmd:{action:'next'}},sender);
  assert.equal(f.commands[1].index,0);assert.equal(f.commands[1].position,0);
});

test('cached shuffle restores original upcoming order and broadcasts controls without starting audio', async () => {
  const entries=['one','three','two'].map(file=>({file,playlist:'Suno'}));
  const f=fixture([{id:8,url:'https://open.spotify.com/home'}],{importedPlayer:{entries,originalEntries:[entries[0],entries[2],entries[1]],index:0,position:42,shuffle:true}});
  await f.send({type:'imported:command',cmd:{action:'shuffle'}},{url:'https://open.spotify.com/home'});
  assert.deepEqual(Array.from(f.values.importedPlayer.entries,e=>e.file),['one','two','three']);
  assert.equal(f.values.importedPlayer.position,42);assert.equal(f.commands.length,0);
  assert.equal(f.calls.at(-1)[2].type,'imported:display');
  assert.equal(f.broadcasts.at(-1).type,'imported:state');
});

test('songs enqueued while idle retain their place after shuffle is disabled', async () => {
  const entries=['one','three','two'].map(file=>({file,playlist:'Suno'}));
  const f=fixture([],{importedPlayer:{entries,originalEntries:[entries[0],entries[2],entries[1]],index:0,shuffle:true}});
  const sender={url:'chrome-extension://extension/library.html'};
  await f.send({type:'imported:command',cmd:{action:'enqueue',entry:{file:'four',playlist:'Suno'}}},sender);
  await f.send({type:'imported:command',cmd:{action:'shuffle'}},sender);
  assert.deepEqual(Array.from(f.values.importedPlayer.entries,e=>e.file),['one','two','three','four']);
  assert.equal(f.broadcasts.at(-1).state.shuffle,false);
});
