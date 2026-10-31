const test = require('node:test');
const assert = require('node:assert/strict');
const { songID, toLRC, createWorker, fetchInPage } = require('../extension/suno-lyrics.js');
const id = '32760529-6f09-47e6-849d-411108ac457c';
const sourceURL = 'https://suno.com/song/' + id;
const words = [
  {word:'(Verse 1)\n',start_s:1}, {word:'There’',start_s:2}, {word:'s ',start_s:2.1},
  {word:'a question\n',start_s:2.3}, {word:'I keep hearing\n',start_s:4}
];
function fixture({ songs, tabs = [{id:7}], status = 'ok', permission = 'granted', beforeWrite, result, time = 1000 } = {}) {
  const tracks = songs || [{file:'one.m4a',sourceURL}];
  const local = {}, session = {}, notices = [], requests = [], writes = [];
  const root = {id:'root',handle:{queryPermission:async ({mode})=>mode==='readwrite'?permission:'granted'}};
  const storage = values => ({get:async key=>({[key]:values[key]}),set:async value=>Object.assign(values,value),remove:async key=>{delete values[key];}});
  const folder = {
    selection:async()=>root,scan:async()=>[{name:'Suno',songs:tracks}],
    update:async (_root, playlist, file, changes, predicate)=>{
      const song=tracks.find(song=>song.file===file);
      await beforeWrite?.(song);
      if(!predicate(song)) return false;
      writes.push({playlist,file,...changes});Object.assign(song,changes);return true;
    }
  };
  const worker=createWorker({folder,now:()=>time,pause:async()=>{},notify:async message=>notices.push(message),chrome:{
    storage:{local:storage(local),session:storage(session)},tabs:{query:async()=>tabs},
    scripting:{executeScript:async request=>{requests.push(request);return [{result:typeof result==='function'?result(request):result||{status,words}}];}}
  }});
  return {worker,tracks,local,session,notices,requests,writes,root};
}
test('source identifiers accept only Suno HTTPS song URLs',()=>{
  assert.equal(songID(sourceURL+'?x=1'),id);
  for(const value of [sourceURL.replace('https:','http:'),sourceURL.replace('suno.com','suno.com.evil.test'),'https://suno.com/song/not-a-uuid','https://suno.com@evil.test/song/'+id]) assert.equal(songID(value),null);
});
test('timing conversion joins word fragments, preserves lines and omits section labels',()=>{
  assert.equal(toLRC(words),'[00:02.00]There’s a question\n[00:04.00]I keep hearing');
  assert.equal(toLRC([{word:'Verse 1\n',start_s:0},{word:'Sing this\n',start_s:2},{word:'Final Chorus (soft)\n',start_s:3}]),'[00:02.00]Sing this');
  assert.equal(toLRC([{word:'bad',start_s:NaN},{word:'bad',start_s:-1}]),'');
});
test('backfill fetches once per song ID, preserves saved lyrics and writes both playlist copies',async()=>{
  const f=fixture({songs:[{file:'one.m4a',sourceURL},{file:'two.m4a',sourceURL},{file:'saved.m4a',sourceURL,lyrics:'My edits'},{file:'unknown.m4a'}]});
  await f.worker.run();await f.worker.run();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].world,'MAIN');
  assert.deepEqual(f.requests[0].args,[id]);
  assert.equal(f.writes.length,2);assert.equal(f.tracks[2].lyrics,'My edits');
  assert.equal(f.notices.at(-1).count,2);
});
test('missing Suno tab prompts once and retries automatically when one opens',async()=>{
  const tabs=[];const f=fixture({tabs});
  await f.worker.run();await f.worker.run();
  assert.equal(f.notices.length,1);assert.match(f.notices[0].message,/Open a Suno tab/);
  tabs.push({id:7});await f.worker.run();assert.equal(f.writes.length,1);
});
test('a signed-out tab is skipped when another signed-in tab is available',async()=>{
  const f=fixture({tabs:[{id:1},{id:2}],result:request=>request.target.tabId===1?{status:'signin'}:{status:'ok',words}});
  await f.worker.run();assert.equal(f.requests.length,2);assert.equal(f.writes.length,1);
  const g=fixture({status:'signin'});await g.worker.run();
  assert.equal(g.writes.length,0);assert.match(g.notices[0].message,/Sign in/);
  assert.equal(JSON.stringify(g.local).includes('Bearer'),false);
});
test('manual lyrics or a changed source arriving during fetch are never overwritten',async()=>{
  for(const mutate of [song=>{song.lyrics='Edited while fetching';},song=>{song.sourceURL=sourceURL.replace(id,'75f1166e-a813-43eb-89ea-df4ddbf6054b');}]){
    const f=fixture({beforeWrite:mutate});await f.worker.run();assert.equal(f.writes.length,0);
  }
});
test('empty alignments back off for a day and explicit retry clears that delay',async()=>{
  const f=fixture({result:{status:'empty'}});await f.worker.run();await f.worker.run();
  assert.equal(f.requests.length,1);
  await f.worker.run({retry:{playlist:'Suno',file:'one.m4a'}});assert.equal(f.requests.length,2);
});
test('rate limiting stops the batch and honors retry-after',async()=>{
  const f=fixture({result:{status:'rate',retryMs:180000}});
  await f.worker.run();await f.worker.run();assert.equal(f.requests.length,1);
  assert.equal(f.local['sunoLyricsAttempts:root'][id].retryAt,181000);
  await f.worker.run({retry:{playlist:'Suno',file:'one.m4a'}});assert.equal(f.requests.length,1);
});
test('read-only folder access never sends an authenticated request',async()=>{
  const f=fixture({permission:'prompt'});await f.worker.run();
  assert.equal(f.requests.length,0);assert.match(f.notices[0].message,/folder access/);
});
test('overlapping scans share one job',async()=>{
  const f=fixture();await Promise.all([f.worker.run(),f.worker.run(),f.worker.run()]);assert.equal(f.requests.length,1);
});
test('page bridge returns lyric data without returning the session token',async()=>{
  const {runInNewContext}=require('node:vm');
  let authorization;
  const result=await runInNewContext('('+fetchInPage.toString()+')('+JSON.stringify(id)+')',{
    location:{origin:'https://suno.com'},document:{cookie:'__session=test-session'},window:{},AbortSignal,
    fetch:async (_url,opts)=>{authorization=opts.headers.Authorization;return {ok:true,status:200,text:async()=>JSON.stringify({aligned_words:words,waveform_data:[1,2,3]})};}
  });
  assert.equal(authorization,'Bearer test-session');
  assert.equal(result.status,'ok');assert.equal(JSON.stringify(result).includes('test-session'),false);
  assert.equal('waveform_data' in result,false);
});
