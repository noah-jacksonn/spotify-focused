import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

// Same library UI with in-memory sample data. Never reads or writes a music folder.
const root = resolve('extension');
const port = Number(process.env.PORT || 8847);
const sample = `
const songs = [
  {file:'one.m4a',title:'Make a Little Room',artist:'Suno',createdAt:'2026-04-19T07:26:00+08:00',lyrics:'[00:00.00]Make a little room\\n[00:08.00]For the feeling that is here\\n[00:16.00]Let the quiet settle in\\n[00:24.00]There is nothing you must prove\\n[00:32.00]Take a breath and stay a while\\n[00:40.00]Let the world keep spinning\\n[00:48.00]You can move at your own pace\\n[00:56.00]Make a little room'},
  {file:'two.m4a',title:'The Quiet Game',artist:'Suno',createdAt:'2026-04-19T19:39:00+08:00'},
  {file:'three.m4a',title:'Hey Buddy',artist:'Suno'},
  {file:'four.m4a',title:'Surrender',artist:'Suno'}
];
let connected = true;
const MusicFolder = {
  selection:async()=>connected ? {id:'preview',handle:{name:'Unslopified Music',queryPermission:async()=>'granted'}} : null,
  scan:async()=>[{name:'Suno',songs}],dir:async()=>null,valid:()=>true,
  disconnect:async()=>{connected=false;},
  presentation:async()=>({gradient:await ImportedArtwork.gradient('Suno/one.m4a'),color:'#514339'}),
  update:async(root,playlist,file,changes)=>Object.assign(songs.find(song=>song.file===file),changes)
};
let state={sourceID:'preview',index:0,entries:songs.map(s=>({...s,playlist:'Suno'})),duration:180,position:34,playing:false,volume:0.7,shuffle:false,repeat:'off'};
window.chrome={storage:{local:{get:async()=>({}),remove:async()=>{}}},runtime:{onMessage:{addListener(){}},sendMessage:async m=>{
  if(m.cmd) {
    const c=m.cmd;
    if(['play','resume','pause'].includes(c.action))state={...state,playing:c.action!=='pause'};
    if(c.action==='seek')state={...state,position:c.position};
    if(c.action==='volume')state={...state,volume:c.volume};
    if(c.action==='shuffle')state={...state,shuffle:!state.shuffle};
    if(c.action==='repeat')state={...state,repeat:state.repeat==='off'?'all':state.repeat==='all'?'one':'off'};
    if(c.action==='play' && c.entries)state={...state,entries:c.entries,index:c.index,position:0};
    if(c.action==='remove')state={...state,entries:state.entries.filter((_,i)=>i!==c.index)};
    if(c.action==='reorder') { const entries=[...state.entries];const [entry]=entries.splice(c.from,1);entries.splice(c.to-(c.from<c.to?1:0),0,entry);state={...state,entries}; }

  }
  return {ok:true,state};
}}};
`;
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:8847');
    if (url.pathname === '/music-folder.js') {
      res.writeHead(200, {'Content-Type':'text/javascript'}).end(sample); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.writeHead(200, {'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':'no-store'}).end(data);
  } catch { res.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log('Library preview: http://127.0.0.1:'+port+'/library.html#Suno'));
