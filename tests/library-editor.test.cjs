const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

const tick = () => new Promise(resolve => setTimeout(resolve, 15));
async function fixture(t, update) {
  const dom = new JSDOM(readFileSync('extension/library.html', 'utf8'), {
    url: 'https://example.test/library.html#Suno', runScripts: 'outside-only'
  });
  const w = dom.window, doc = w.document;
  t.after(() => w.close());
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.TextEncoder = TextEncoder;
  w.URL.revokeObjectURL = () => {};
  w.URL.createObjectURL = () => "blob:test";
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const song = {file:'song.m4a',title:'Original',artist:'Suno',createdAt:'2026-04-19T07:26:00+08:00',sourceURL:'https://suno.com/song/example'};
  const writes = [];
  w.MusicFolder = {
    selection: async () => ({id:'library',handle:{name:'Music',queryPermission:async()=>'granted'}}),
    scan: async () => [{name:'Suno',songs:[{...song}]}], dir:async()=>null, valid:()=>true,
    update: async (root, playlist, file, changes) => {
      writes.push(structuredClone(changes));
      await update?.(changes);
      Object.assign(song, changes);
    }
  };
  w.chrome = {storage:{local:{get:async()=>({})}},runtime:{sendMessage:async()=>({ok:true}),onMessage:{addListener(){}}}};
  for (const file of ['control-icons.js', 'imported-artwork.js', 'imported-player-view.js', 'lyrics-view.js', 'queue-view.js', 'library.js']) w.eval(readFileSync('extension/'+file,'utf8'));
  await tick();
  assert.ok(doc.querySelector('[aria-label="Details for Original"]'), doc.getElementById('notice').textContent);
  doc.querySelector('[aria-label="Details for Original"]').click();
  await tick();
  const input = (id, value, event = 'input') => {
    doc.getElementById(id).value = value;
    doc.getElementById(id).dispatchEvent(new w.Event(event, {bubbles:true}));
  };
  const backdrop = id => {
    const dialog = doc.getElementById(id);
    dialog.getBoundingClientRect = () => ({left:100,top:100,right:500,bottom:600});
    dialog.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:30,clientY:30,bubbles:true}));
    dialog.dispatchEvent(new w.MouseEvent('click',{clientX:30,clientY:30,bubbles:true}));
  };
  return {w,doc,song,writes,input,backdrop};
}

test('edits autosave without a Save button and preserve untouched timestamps and metadata', async t => {
  const f = await fixture(t);
  assert.equal(f.doc.querySelector('#editorForm button[type="submit"]'), null);
  f.input('songTitle','New title','change');
  await tick();
  assert.equal(f.song.title,'New title');
  assert.deepEqual(f.writes,[{title:'New title'}]);
  assert.equal(f.song.createdAt,'2026-04-19T07:26:00+08:00');
  assert.equal(f.doc.getElementById('editor').open,true);
});

test('clicking outside flushes pending text before dismissing and refreshing the row', async t => {
  const f = await fixture(t);
  f.input('songTitle','Saved on close');
  f.backdrop('editor');
  await tick();
  assert.equal(f.song.title,'Saved on close');
  assert.equal(f.doc.getElementById('editor').open,false);
  assert.ok(f.doc.querySelector('[aria-label="Details for Saved on close"]'));
});

test('slow writes are serialized and closing retains the newest edit', async t => {
  let release;
  const f = await fixture(t, () => new Promise(resolve => { release = resolve; }));
  f.input('songTitle','First','change'); await tick();
  f.input('songTitle','Latest');
  f.backdrop('editor');
  assert.equal(f.doc.getElementById('editor').open,true);
  release(); await tick();
  release(); await tick();
  assert.equal(f.song.title,'Latest');
  assert.equal(f.doc.getElementById('editor').open,false);
  assert.deepEqual(f.writes,[{title:'First'},{title:'Latest'}]);
});

test('a failed save keeps the edit visible and can be retried', async t => {
  let fails = true;
  const f = await fixture(t, async () => { if (fails) throw Error('Folder unavailable'); });
  f.input('songTitle','Keep my edit'); f.backdrop('editor'); await tick();
  assert.equal(f.doc.getElementById('editor').open,true);
  assert.equal(f.doc.getElementById('songTitle').value,'Keep my edit');
  assert.match(f.doc.querySelector('#editor .dialogStatus').textContent,/Folder unavailable/);
  fails = false; f.backdrop('editor'); await tick();
  assert.equal(f.song.title,'Keep my edit');
  assert.equal(f.doc.getElementById('editor').open,false);
});

test('invalid fields stay visible; an inside-to-outside drag does not dismiss a dialog', async t => {
  const f = await fixture(t);
  const dialog = f.doc.getElementById('editor');
  dialog.getBoundingClientRect = () => ({left:100,top:100,right:500,bottom:600});
  dialog.dispatchEvent(new f.w.MouseEvent('pointerdown',{clientX:200,clientY:200,bubbles:true}));
  dialog.dispatchEvent(new f.w.MouseEvent('click',{clientX:30,clientY:30,bubbles:true}));
  assert.equal(dialog.open,true);
  f.input('songTitle',''); f.backdrop('editor'); await tick();
  assert.equal(dialog.open,true);
  assert.equal(f.writes.length,0);
});

test('other dialogs also dismiss when clicking outside', async t => {
  const f = await fixture(t);
  f.doc.getElementById('closeEditor').click(); await tick();
  for (const id of ['createDialog','folderDialog']) {
    f.doc.getElementById(id).showModal();
    f.backdrop(id);
    assert.equal(f.doc.getElementById(id).open,false,id);
  }
});

test('background refresh leaves an open dialog error visible', async t => {
 const f=await fixture(t);
 f.doc.getElementById('closeEditor').click();await tick();
 f.doc.getElementById('create').click();
 const status=f.doc.querySelector('#createDialog .dialogStatus');
 status.textContent='Choose another name.';status.hidden=false;
 f.w.dispatchEvent(new f.w.Event('focus'));await tick();
 assert.equal(status.textContent,'Choose another name.');assert.equal(status.hidden,false);
});
