const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');
const id = 'a'.repeat(22);

test('accepts only Spotify playlist identifiers and URLs', () => {
  for (const value of [id, `spotify:playlist:${id}`, `listrow-title-spotify:playlist:${id}`, `/playlist/${id}`, `https://open.spotify.com/playlist/${id}?si=example`, `/intl-en/playlist/${id}`]) assert.equal(C.playlistId(value), id);
  for (const value of [`https://evil.example/playlist/${id}`, 'javascript:alert(1)', '/playlist/short', `spotify:album:${id}`, `https://open.spotify.com.evil.test/playlist/${id}`]) assert.equal(C.playlistId(value), null);
});

test('artwork only uses Spotify HTTPS image hosts', () => {
  assert.equal(C.imageUrl('https://i.scdn.co/image/cover'), 'https://i.scdn.co/image/cover');
  for (const url of ['http://i.scdn.co/image/cover', 'https://scdn.co.evil.test/cover', 'data:image/svg+xml,evil', 'https://tracking.example/cover']) assert.equal(C.imageUrl(url), '');
});

test('stored Home validates data, deduplicates, preserves order, and honors an empty chosen Home', () => {
  const a = { id, name: 'First', image: 'javascript:bad' };
  const b = { id: 'b'.repeat(22), name: 'Second' };
  const state = C.settings({ home: [a, b, a, { id: 'bad', name: 'Invalid' }], enabled: false });
  assert.deepEqual(state.home.map(p => p.name), ['First', 'Second']);
  assert.equal(state.home[0].image, '');
  assert.equal(state.enabled, false);
  assert.equal(state.didChooseHome, true);
  assert.equal(C.settings({ home: [], didChooseHome: true }).didChooseHome, true);
});

test('only empty search and Home routes replace native content', () => {
  for (const path of ['/', '/home', '/home/', '/intl-en/home']) assert.equal(C.route(path), 'home');
  assert.equal(C.route('/search'), 'search-empty');
  assert.equal(C.route('/search/Clairo'), 'content');
  assert.equal(C.route('/show/example'), 'content');
  assert.equal(C.route(`/playlist/${id}`), 'playlist');
});

test('old automatic seed messages cannot choose a playlist for a new user', () => {
  const empty = C.settings();
  assert.deepEqual(C.applyOperation(empty, {kind:'seed',playlist:{id,name:'End of 2026'},selected:true}), empty);
});
