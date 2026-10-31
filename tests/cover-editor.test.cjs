const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const {webcrypto} = require('node:crypto');

function fixture() {
  const files = new Map();
  const valid = name => typeof name === 'string' && !!name && !name.startsWith('.') && !/[\\/\x00-\x1f]/.test(name);
  const folder = {getFileHandle: async name => {
    if (!files.has(name)) throw Object.assign(Error('Missing'), {name:'NotFoundError'});
    return {getFile: async () => files.get(name)};
  }};
  const MusicFolder = {valid, write: async (_, name, bytes) => files.set(name, bytes instanceof Blob ? bytes : new Blob([bytes]))};
  const context = {MusicFolder,crypto:webcrypto,Blob};
  runInNewContext(readFileSync('extension/cover-editor.js','utf8')+'\nglobalThis.cover=SharedCover;',context);
  return {cover:context.cover,files,folder,MusicFolder};
}

test('cover edits preserve original bytes and normalized crop across saves', async () => {
  const {cover,files,folder} = fixture();
  const original = new Blob([new Uint8Array([10,20,30,40])]);
  const edit = {original,originalExtension:'heic',preview:new Blob(['uncropped preview']),jpeg:new Blob(['first render']),crop:{zoom:2.5,x:-0.3,y:0.2}};
  await cover.save(folder,edit);
  const reopened = await cover.read(folder);
  assert.deepEqual([...new Uint8Array(await reopened.original.arrayBuffer())],[10,20,30,40]);
  assert.equal(JSON.stringify(reopened.crop),JSON.stringify(edit.crop));
  assert.equal(reopened.originalExtension,'heic');
  await cover.save(folder,{...reopened,jpeg:new Blob(['second render']),crop:{zoom:3,x:0.1,y:-0.2}});
  assert.equal([...files.keys()].filter(name=>name.startsWith('cover-original-')).length,1);
  assert.equal([...files.keys()].filter(name=>name.startsWith('cover-source-')).length,1);
  files.set('cover.jpg',new Blob(['delayed old render']));
  const recipe = JSON.parse(await files.get('cover.json').text());
  assert.equal(await files.get(recipe.renderedFile).text(),'second render');
  assert.equal((await cover.read(folder)).crop.zoom,3);
});

test('a failed upload leaves the previous cover recipe usable', async () => {
  const {cover,files,folder,MusicFolder} = fixture();
  const edit = {original:new Blob(['photo']), originalExtension:'png', preview:new Blob(['preview']), jpeg:new Blob(['render']),crop:{zoom:1,x:0,y:0}};
  await cover.save(folder,edit);
  const before = await files.get('cover.json').text();
  const write = MusicFolder.write;
  MusicFolder.write = (folder,name,bytes) => {
    if(name.startsWith('cover-source-')) throw Error('Offline');
    return write(folder,name,bytes);
  };
  await assert.rejects(cover.save(folder,{...edit,original:new Blob(['new photo']),preview:new Blob(['new preview'])}),/Offline/);
  assert.equal(await files.get('cover.json').text(),before);
  assert.equal((await cover.read(folder)).crop.zoom,1);
});

test('older covers open at their original centered crop; incomplete recipes stay recoverable', async () => {
  const {cover,files,folder} = fixture();
  assert.equal(await cover.read(folder),null);
  files.set('cover.jpg',new Blob(['legacy']));
  assert.equal((await cover.read(folder)).crop.zoom,1);
  files.set('cover.json',new Blob([JSON.stringify({version:1,originalFile:'cover-original-missing.heic',previewFile:'cover-source-missing.jpg',renderedFile:'cover-rendered-missing.jpg',crop:{zoom:1,x:0,y:0}})]));
  await assert.rejects(cover.read(folder), {name:'NotFoundError'});
  files.set('cover.json',new Blob([JSON.stringify({version:1,originalFile:'cover-original-../../outside',previewFile:'cover-source-ok.jpg',renderedFile:'cover-rendered-ok.jpg',crop:{zoom:1,x:0,y:0}})]));
  await assert.rejects(cover.read(folder),/saved crop/);
});

test('web crop geometry matches iOS and never exposes empty edges', () => {
  const {cover} = fixture();
  const example = cover.rect({zoom:2,x:-0.25,y:0.4},4000,3000,640);
  assert.ok(Math.abs(example.x - -693.3333333333333) < 1e-8);
  assert.ok(Math.abs(example.y - -64) < 1e-8);
  for (const [width,height] of [[4000,3000],[1200,4000],[640,640],[20000,1000]]) {
    for (const zoom of [-2,1,2.3,6,20]) for (const x of [-100,-0.3,0,0.3,100]) for (const y of [-100,-0.3,0,0.3,100]) {
      const a=cover.rect({zoom,x,y},width,height,280),b=cover.rect({zoom,x,y},width,height,640);
      assert.ok(a.x<=1e-8&&a.y<=1e-8&&a.x+a.width>=280-1e-8&&a.y+a.height>=280-1e-8);
      assert.ok(Math.abs(a.x/280-b.x/640)<1e-8&&Math.abs(a.y/280-b.y/640)<1e-8);
    }
  }
});
