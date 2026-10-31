const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {JSDOM}=require('jsdom');
const {webcrypto}=require('node:crypto');
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
async function fixture(t, access){
 const dom=new JSDOM(readFileSync('extension/library.html','utf8'),{url:'https://example.test/library.html#Suno',runScripts:'outside-only'});
 const w=dom.window,doc=w.document,messages=[],imports=[],listeners=[];
 t.after(()=>w.close());
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.matchMedia=()=>({matches:true});w.URL.revokeObjectURL=()=>{};
 w.MusicFolder={selection:async()=>({id:'test',handle:access || {name:'Music',queryPermission:async()=>'granted'}}),lastScan:async()=>[{name:'Suno',songs:[]}],presentation:async()=>null,scan:async()=>[{name:'Suno',songs:[]}],dir:async()=>({}),importFile:async(...args)=>{imports.push(args);return true;}};
 w.chrome={storage:{local:{get:async()=>({})}},runtime:{sendMessage:async message=>{messages.push(message);return {ok:true};},onMessage:{addListener:listener=>listeners.push(listener)}}};
 for(const name of ['control-icons.js','imported-artwork.js','imported-player-view.js','lyrics-view.js','queue-view.js','library.js'])w.eval(readFileSync('extension/'+name,'utf8'));
 await tick();return {w,doc,messages,imports,emit:message=>listeners.forEach(listener=>listener(message))};
}
test('missing-tab notice appears as a transient toast without changing the import button',async t=>{
 const f=await fixture(t);f.emit({type:'imported:lyrics-notice',message:'Open a Suno tab to finish importing lyrics.'});
 assert.equal(f.doc.getElementById('lyricsToast').hidden,false);
 assert.match(f.doc.getElementById('lyricsToast').textContent,/Open a Suno tab/);
 assert.equal(f.doc.getElementById('import').textContent,'Import songs');
});
test('one audio import carries its companion metadata and starts automatic lyric retrieval',async t=>{
 const f=await fixture(t);
 const sourceURL='https://suno.com/song/32760529-6f09-47e6-849d-411108ac457c';
 const files=[{name:'song.m4a'},{name:'song.m4a.json',text:async()=>JSON.stringify({sourceURL,title:'A song'})}];
 Object.defineProperty(f.doc.getElementById('files'),'files',{value:files});
 f.doc.getElementById('files').dispatchEvent(new f.w.Event('change'));
 await tick();assert.equal(f.imports.length,1);assert.equal(f.imports[0][2].sourceURL,sourceURL);
 assert.ok(f.messages.some(message=>message.type==='imported:lyrics-start'));
});

test('Space toggles playback once, while typing and open editors keep their keyboard behavior',async t=>{
 const f=await fixture(t);
 const state={entries:[{title:'Song',artist:'Suno',playlist:'Suno',file:'song.m4a'}],index:0,playing:true};
 f.emit({type:'imported:state',state});
 const press=(target,options={})=>{const event=new f.w.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
 assert.equal(press(f.doc.body).defaultPrevented,true);
 await tick();assert.equal(f.messages.at(-1).cmd.action,'pause');
 f.emit({type:'imported:state',state:{...state,playing:false}});
 press(f.doc.body);await tick();assert.equal(f.messages.at(-1).cmd.action,'resume');
 const count=f.messages.length;
 press(f.doc.body,{repeat:true});
 assert.equal(press(f.doc.getElementById('songLyrics')).defaultPrevented,false);
 f.doc.getElementById('editor').open=true;
 assert.equal(press(f.doc.body).defaultPrevented,false);
 await tick();assert.equal(f.messages.length,count);
});


test('lyrics fill a page and keep the same line nodes as highlighting advances',async t=>{
 const f=await fixture(t);
 f.w.MusicFolder.scan=async()=>[{name:'Suno',songs:[{file:'song.m4a',title:'Song',artist:'Suno',lyrics:'[00:01.00]First line\n[00:05.00]Second line'}]}];
 f.emit({type:'imported:lyrics-updated',count:1});await tick();
 const state={sourceID:'test',index:0,position:2,duration:20,playing:false,entries:[{file:'song.m4a',playlist:'Suno',title:'Song',artist:'Suno'}]};
 f.emit({type:'imported:state',state});
 f.doc.getElementById('lyricsButton').click();
 assert.equal(f.doc.getElementById('lyricsPage').hidden,false);
 assert.equal(f.doc.getElementById('lyricsDialog'),null);
 const first=f.doc.querySelector('.lyric-line');
 assert.equal(first.getAttribute('aria-current'),'true');
 f.emit({type:'imported:progress',sourceID:'test',index:0,position:6});
 assert.equal(first,f.doc.querySelector('.lyric-line'));
 assert.equal(f.doc.querySelectorAll('.lyric-line')[1].getAttribute('aria-current'),'true');
 first.click();await tick();assert.equal(f.messages.at(-1).cmd.position,1);
 f.doc.getElementById('lyricsScroll').dispatchEvent(new f.w.WheelEvent('wheel'));
 assert.equal(f.doc.getElementById('followLyrics').getAttribute('aria-pressed'),'false');
 f.doc.getElementById('closeLyrics').click();assert.equal(f.doc.getElementById('lyricsPage').hidden,true);
});


test('queue is a side panel that coexists with lyrics and preserves upcoming queue indexes',async t=>{
 const f=await fixture(t);
 const entries=['Past','Current','Upcoming','Last'].map(title=>({file:title+'.m4a',playlist:'Suno',title,artist:'Suno'}));
 f.emit({type:'imported:state',state:{sourceID:'test',index:1,entries,playing:false}});
 f.doc.getElementById('lyricsButton').click();f.doc.getElementById('queueButton').click();
 assert.equal(f.doc.getElementById('queuePanel').hidden,false);
 assert.equal(f.doc.getElementById('queueDialog'),null);
 assert.equal(f.doc.getElementById('lyricsPage').hidden,false);
 assert.equal(f.doc.querySelector('#queueNow .queue-title').textContent,'Current');
 assert.equal(f.doc.querySelectorAll('#queueList .queue-row').length,2);
 assert.equal(f.doc.getElementById('queueNextLabel').textContent,'Next from: Suno');
 f.doc.querySelector('#queueList .queue-track').click();await tick();
 assert.equal(f.messages.at(-1).cmd.index,2);
  assert.equal(f.messages.at(-1).cmd.restoreOrder,true);
 f.doc.querySelector('[aria-label="Remove Upcoming from queue"]').click();await tick();
 assert.equal(f.messages.at(-1).cmd.action,'remove');assert.equal(f.messages.at(-1).cmd.index,2);
 f.doc.body.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(f.doc.getElementById('queuePanel').hidden,true);
 assert.equal(f.doc.getElementById('lyricsPage').hidden,false);
});


test('Follow lyrics toggles tracking off and on without re-enabling on progress', async t => {
 const f=await fixture(t);
 f.w.MusicFolder.scan=async()=>[{name:'Suno',songs:[{file:'song.m4a',lyrics:'[00:01.00]One\n[00:05.00]Two\n[00:10.00]Three'}]}];
 f.emit({type:'imported:lyrics-updated',count:1});await tick();
 f.emit({type:'imported:state',state:{sourceID:'test',index:0,position:2,entries:[{file:'song.m4a',playlist:'Suno'}]}});
 f.doc.getElementById('lyricsButton').click();
 const follow=f.doc.getElementById('followLyrics');
 let scrolls=0;
 f.doc.querySelectorAll('.lyric-line').forEach(line=>line.scrollIntoView=()=>scrolls++);
 assert.equal(follow.getAttribute('aria-pressed'),'true');
 follow.click();assert.equal(follow.getAttribute('aria-pressed'),'false');
 f.emit({type:'imported:progress',sourceID:'test',index:0,position:6});
 assert.equal(scrolls,0);assert.equal(follow.getAttribute('aria-pressed'),'false');
 follow.click();assert.equal(follow.getAttribute('aria-pressed'),'true');assert.equal(scrolls,1);
 f.emit({type:'imported:progress',sourceID:'test',index:0,position:11});assert.equal(scrolls,2);
});

test('Refresh and edits do not request folder access; only explicit Reconnect does', async t => {
 let granted=false, requests=0;
 const access={name:'Music',queryPermission:async()=>granted?'granted':'prompt',requestPermission:async()=>{requests++;granted=true;return 'granted';}};
 const f=await fixture(t,access);
 const refresh=f.doc.getElementById('refresh'), reconnect=f.doc.getElementById('reconnect');
 refresh.click();await tick();assert.equal(requests,0);assert.equal(reconnect.hidden,false);
 f.doc.getElementById('import').click();await tick();assert.equal(requests,0);
 reconnect.click();await tick();assert.equal(requests,1);assert.equal(reconnect.hidden,true);
 refresh.click();await tick();assert.equal(requests,1);
});

test('a readable folder stays browsable when edit access expires', async t => {
 let requests=0;
 const f=await fixture(t,{name:'Music',queryPermission:async({mode})=>mode==='read'?'granted':'prompt',requestPermission:async()=>{requests++;return 'granted';}});
 f.doc.getElementById('refresh').click();await tick();
 assert.equal(f.doc.getElementById('connected').hidden,false);
 assert.equal(f.doc.getElementById('reconnect').hidden,false);
 f.doc.getElementById('import').click();await tick();
 assert.equal(requests,0);assert.match(f.doc.getElementById('notice').textContent,/Reconnect folder/);
});

test('background permission checks stay quiet while lyrics are open', async t => {
 const f=await fixture(t,{name:'Music',queryPermission:async({mode})=>mode==='read'?'granted':'prompt'});
 f.doc.getElementById('lyricsButton').click();
 f.w.dispatchEvent(new f.w.Event('focus'));await tick();
 assert.equal(f.doc.getElementById('lyricsToast').hidden,true);
 assert.equal(f.doc.getElementById('followLyrics').hidden,true);
});
