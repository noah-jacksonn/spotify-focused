const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');

function fixture() {
  const values = new Map(), files = new Map(), writes = [];
  let unavailable = false, failCache = false;
  const folder = {
    name:'Suno', async *entries() { for (const [name, blob] of files) yield [name,{kind:'file',getFile:async()=>blob}]; },
    async getFileHandle(name, options) {
      if (unavailable) throw Object.assign(Error('Access expired'),{name:'NotAllowedError'});
      if (!files.has(name) && !options?.create) throw Object.assign(Error('Missing'),{name:'NotFoundError'});
      return {getFile:async()=>files.get(name),createWritable:async()=>({write:async data=>files.set(name,data),close:async()=>{},abort:async()=>{}})};
    }
  };
  const root = {id:'test',handle:{getDirectoryHandle:async()=>folder}};
  const context = {Response,Blob,console,setTimeout,clearTimeout,
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
    Audio:class {set src(value) {queueMicrotask(()=>this.onerror());} removeAttribute(){} load(){}},
    navigator:{locks:{request:async(key,callback)=>callback()}},
    indexedDB:{open() {
      const request={result:{transaction() {
        let result, key, data, method;
        const tx={objectStore:()=>({
          put(value,name) {method='put';key=name;data=value;writes.push(name);return result={};},
          get(name) {return result={result:values.get(name)};}
        })};
        queueMicrotask(()=>{
          if (method==='put' && failCache) {tx.error=Error('Cache full');tx.onabort();}
          else {if(method==='put')values.set(key,data);tx.oncomplete();}
        });return tx;
      }}};
      queueMicrotask(()=>request.onsuccess());return request;
    }}
  };
  runInNewContext(readFileSync('extension/music-folder.js','utf8')+'\nglobalThis.api=MusicFolder;',context);
  return {api:context.api,root,folder,files,writes,setUnavailable:value=>unavailable=value,setFailCache:value=>failCache=value};
}

test('normal playback reads files without growing the cache; Keep offline saves a usable copy',async()=>{
  const f=fixture(), song=new Blob(['audio']);f.files.set('song.mp3',song);
  assert.equal(await f.api.audio(f.root,'Suno','song.mp3'),song);
  assert.equal(f.writes.length,0);
  await f.api.audio(f.root,'Suno','song.mp3',{cache:true});assert.equal(f.writes.length,1);
  f.setUnavailable(true);
  assert.equal(await (await f.api.audio(f.root,'Suno','song.mp3')).text(),'audio');
});

test('a failed offline cache write does not prevent ordinary playback',async()=>{
  const f=fixture(), song=new Blob(['audio']);f.files.set('song.mp3',song);f.setFailCache(true);
  await assert.rejects(f.api.audio(f.root,'Suno','song.mp3',{cache:true}),/Cache full/);
  assert.equal(await f.api.audio(f.root,'Suno','song.mp3'),song);
});

test('audio imports survive unsupported duration metadata for sharing to another device',async()=>{
  const f=fixture(), song=new Blob(['aiff audio']);Object.defineProperty(song,'name',{value:'Song.aiff'});
  assert.equal(await f.api.importFile(f.folder,song,{title:'My song'}),true);
  assert.equal(f.files.get('Song.aiff'),song);
  const metadata=JSON.parse(f.files.get('Song.aiff.json'));
  assert.equal(metadata.title,'My song');assert.equal(metadata.durationMs,undefined);
});

test('recreating an archived playlist chooses a free name and preserves the archive',async()=>{
  const f=fixture();
  const missing=()=>Object.assign(Error('Missing'),{name:'NotFoundError'});
  const directories=new Map([
    ['Suno',{name:'Suno',getFileHandle:async()=>({})}],
    ['Suno (2)',{name:'Suno (2)',getFileHandle:async()=>{throw missing();}}]
  ]);
  f.root.handle.getDirectoryHandle=async(name,options)=>{
    if(directories.has(name))return directories.get(name);
    if(!options?.create)throw missing();
    const handle={name};directories.set(name,handle);return handle;
  };
  assert.equal((await f.api.create(f.root,'Suno')).name,'Suno (3)');
  assert.ok(directories.has('Suno'));
  await assert.rejects(f.api.create(f.root,'Suno (2)'),/already exists/);
});
