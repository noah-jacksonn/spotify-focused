const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');
const { createStore } = require('../extension/store.js');

test('one writer merges concurrent tab selections and popup settings without overwriting', async () => {
  let data = {};
  const store = createStore({ async get() { return structuredClone(data); }, async set(value) { await new Promise(resolve => setTimeout(resolve, 5)); data = structuredClone(value); } });
  const a = { id: 'a'.repeat(22), name: 'A' }, b = { id: 'b'.repeat(22), name: 'B' };
  await Promise.all([
    store.update({ kind: 'home', playlist: a, selected: true }),
    store.update({ kind: 'home', playlist: b, selected: true }),
    store.update({ kind: 'enabled', enabled: false }),
    store.update({ kind: 'metadata', playlists: [{ ...a, name: 'Renamed' }] })
  ]);
  assert.equal(data[C.STORAGE_KEY].enabled, false);
  assert.deepEqual(data[C.STORAGE_KEY].home.map(p => p.name), ['Renamed', 'B']);
  assert.equal(data[C.STORAGE_KEY].revision, 4);
  await store.update({ kind: 'home', playlist: a, selected: false });
  await store.update({ kind: 'metadata', playlists: [a] });
  assert.deepEqual(data[C.STORAGE_KEY].home.map(p => p.id), [b.id]);
});

test('a failed storage write does not block the next operation', async () => {
  let data = {}, fail = true;
  const store = createStore({ async get() { return data; }, async set(value) { if (fail) { fail = false; throw Error('quota'); } data = value; } });
  await assert.rejects(store.update({ kind: 'enabled', enabled: false }));
  await store.update({ kind: 'enabled', enabled: false });
  assert.equal(data[C.STORAGE_KEY].enabled, false);
});
