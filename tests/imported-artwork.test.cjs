const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const {webcrypto}=require('node:crypto');

function fixture(files) {
  const images=[],draws=[];
  const file=(name,value)=>({kind:'file',getFile:async()=>{if(typeof value==='string')return {text:async()=>value};images.push(name);return value;}});
  const folder={kind:'directory',getFileHandle:async name=>{if(!(name in files))throw Object.assign(Error('missing'),{name:'NotFoundError'});return file(name,files[name]);},async *entries(){for(const [name,value] of Object.entries(files))yield [name,file(name,value)];}};
  const root={id:'test',handle:{getDirectoryHandle:async()=>folder,async *entries(){yield ['Suno',folder];}}};
  const ctx={URL,TextEncoder,crypto:webcrypto,Response,Blob,btoa,console,
    indexedDB:{open(){const request={result:{transaction(){const tx={objectStore:()=>({put:()=>({})})};queueMicrotask(()=>tx.oncomplete());return tx;}}};queueMicrotask(()=>request.onsuccess());return request;}},
    createImageBitmap:async()=>({width:200,height:100,close(){}}),
    OffscreenCanvas:class{getContext(){return {drawImage:(...args)=>draws.push(args)};}async convertToBlob(){return new Blob(['thumbnail']);}}
  };
  runInNewContext(readFileSync('extension/imported-artwork.js','utf8'),ctx);
  runInNewContext(readFileSync('extension/music-folder.js','utf8')+'\nglobalThis.folderAPI=MusicFolder;',ctx);
  return {...ctx,root,images,draws};
}
test('Home and detail choose the current cropped cover and invalidate old thumbnails',async()=>{
  const f=fixture({'cover.json':JSON.stringify({version:1,renderedFile:'cover-rendered-new.jpg'}),'cover-rendered-new.jpg':{size:20,lastModified:30},'cover.jpg':{size:20,lastModified:30}});
  const lists=await f.folderAPI.scan(f.root);
  assert.equal(f.ImportedArtwork.source(lists[0]),'cover-rendered-new.jpg');
  const [home]=await f.folderAPI.home(f.root,[],[{name:'Suno',coverRevision:'20:30',image:'stale'}]);
  assert.match(home.coverRevision,/cover-rendered-new.jpg/);assert.notEqual(home.image,'stale');
  assert.ok(f.images.includes('cover-rendered-new.jpg'));assert.ok(!f.images.includes('cover.jpg'));
  assert.deepEqual(f.draws[0].slice(1),[50,0,100,100,0,0,128,128]);
});
test('without a custom cover Home uses the same first-song artwork as detail',async()=>{
  const f=fixture({'first.mp3':{lastModified:1},'second.mp3':{lastModified:2},'first.mp3.json':JSON.stringify({order:0,artworkFile:'first.jpg'}),'first.jpg':{size:20,lastModified:30}});
  const lists=await f.folderAPI.scan(f.root);
  assert.equal(f.ImportedArtwork.source(lists[0]),'first.jpg');
  const [home]=await f.folderAPI.home(f.root);assert.ok(home.image);assert.ok(f.images.includes('first.jpg'));
});
test('fallback artwork is stable for a playlist and differs between playlists',async()=>{
  const f=fixture({});const [home]=await f.folderAPI.home(f.root);assert.equal(home.image,undefined);
  assert.equal(await f.ImportedArtwork.gradient('Suno'),await f.ImportedArtwork.gradient(home.name));
  assert.notEqual(await f.ImportedArtwork.gradient('Suno'),await f.ImportedArtwork.gradient('Other'));
});

test('blank shared metadata falls back to a visible title and artist',async()=>{
  const f=fixture({'Song.mp3':{lastModified:1},'Song.mp3.json':JSON.stringify({title:'  ',artist:'\n'})});
  const [list]=await f.folderAPI.scan(f.root);
  assert.equal(list.songs[0].title,'Song');assert.equal(list.songs[0].artist,'Unknown artist');
});
