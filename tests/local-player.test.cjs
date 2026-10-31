const test=require('node:test');
const assert=require('node:assert/strict');
const {runInNewContext}=require('node:vm');
const {readFileSync}=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
 let listener;const messages=[];
 const audio={paused:true,currentTime:0,duration:120,volume:1,pause(){this.paused=true;},async play(){this.paused=false;this.onplaying?.();},removeAttribute(){},load(){}};
 const rng=Object.create(Math);rng.random=()=>0;
 runInNewContext(readFileSync('extension/local-player.js','utf8'),{
  document:{getElementById:()=>audio},URL:{createObjectURL:()=>'',revokeObjectURL(){}},Math:rng,
  navigator:{mediaSession:{setActionHandler(){}}},MediaMetadata:class{},
  MusicFolder:{selection:async()=>({id:'test'}),audio:async()=>({}),presentation:async()=>({gradient:'test'})},
  chrome:{runtime:{id:'test',sendMessage:async message=>{messages.push(message);},onMessage:{addListener:fn=>{listener=fn;}}}}
 });
 const command=cmd=>new Promise(resolve=>listener({target:'imported-player',cmd},{id:'test'},resolve));
 const entries=['one','two','three','four'].map(file=>({file,playlist:'Suno',title:file,artist:'Suno'}));
 return {audio,messages,command,entries};
}
test('shuffle preserves the current song and disabling it restores remaining song order',async()=>{
 const f=fixture();await f.command({action:'play',sourceID:'test',entries:f.entries,index:0});
 const mixed=(await f.command({action:'shuffle'})).state;
 assert.equal(mixed.shuffle,true);assert.equal(mixed.entries[mixed.index].file,'one');
 const restored=(await f.command({action:'shuffle'})).state;
 assert.deepEqual(Array.from(restored.entries,e=>e.file),['one','two','three','four']);
});
test('repeat one replays the current song; repeat all loops the end of the queue',async()=>{
 const f=fixture();await f.command({action:'play',sourceID:'test',entries:f.entries,index:3});
 assert.equal((await f.command({action:'repeat'})).state.repeat,'all');
 f.audio.onended();await tick();assert.equal(f.messages.filter(m=>m.type==='imported:state').at(-1).state.index,0);
 assert.equal((await f.command({action:'repeat'})).state.repeat,'one');
 await f.command({action:'next'});f.audio.onended();await tick();
 assert.equal(f.messages.filter(m=>m.type==='imported:state').at(-1).state.index,1);
 assert.equal((await f.command({action:'repeat'})).state.repeat,'off');
});


test('reordering upcoming songs preserves the current song and playback position',async()=>{
 const f=fixture();await f.command({action:'play',sourceID:'test',entries:f.entries,index:1});f.audio.currentTime=42;
 const state=(await f.command({action:'reorder',from:3,to:2})).state;
 assert.deepEqual(Array.from(state.entries,e=>e.file),['one','two','four','three']);assert.equal(state.index,1);assert.equal(state.position,42);
 const invalid=(await f.command({action:'reorder',from:1,to:4})).state;
 assert.equal(invalid.entries[1].file,'two');
});

test('restoring a paused shuffled queue keeps its saved order',async()=>{
 const f=fixture();
 const state=(await f.command({action:'play',sourceID:'test',entries:f.entries,index:0,position:42,shuffle:true,restoreOrder:true})).state;
 assert.deepEqual(Array.from(state.entries,e=>e.file),['one','two','three','four']);
 assert.equal(state.position,42);
});
