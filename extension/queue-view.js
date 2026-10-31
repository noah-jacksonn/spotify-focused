globalThis.ImportedQueue = {
  mount(panel, { command, artwork }) {
    const now = panel.querySelector('#queueNow');
    const list = panel.querySelector('#queueList');
    let current, signature, version = 0;
    const run = (action, extra = {}) => Promise.resolve(command(action, extra)).catch(() => {});
    function row(entry, index, playing, turn) {
      const li = document.createElement('li');li.className='queue-row';
      const track = document.createElement('button');track.className='queue-track';track.type='button';
      track.setAttribute('aria-label',(playing && current.playing?'Pause ':'Play ')+entry.title);
      const cover = document.createElement('span');cover.className='queue-art';cover.setAttribute('aria-hidden','true');
      const glyph = document.createElement('span');glyph.className='queue-play';cover.append(glyph);
      glyph.append(FocusedIcons.create(playing && current.playing?'pause':'play'));
      const copy=document.createElement('span');copy.className='queue-copy';
      const title=document.createElement('span');title.className='queue-title';title.textContent=entry.title;
      const artist=document.createElement('span');artist.className='queue-artist';artist.textContent=entry.artist;
      copy.append(title,artist);track.append(cover,copy);li.append(track);
      if(playing){li.classList.add('queue-current');li.setAttribute('aria-current','true');}
      track.onclick=()=> playing ? run(current.playing?'pause':'resume') : run('play',{
        entries:current.entries,originalEntries:current.originalEntries,sourceID:current.sourceID,
        shuffle:current.shuffle,repeat:current.repeat,restoreOrder:true,index
      });
      ImportedArtwork.gradient(entry.playlist+'/'+entry.file).then(gradient=>{if(version===turn)cover.style.backgroundImage=gradient;});
      Promise.resolve(artwork(entry)).then(image=>{
        if(version===turn && image?.image)cover.style.backgroundImage='url("'+image.image+'")';
      }).catch(()=>{});
      if(!playing){
        li.draggable=true;
        li.ondragstart=event=>{
          if(event.target.closest('.queue-menu')){event.preventDefault();return;}
          event.dataTransfer.setData('text/plain',String(index));event.dataTransfer.effectAllowed='move';
        };
        li.ondragover=event=>{event.preventDefault();event.dataTransfer.dropEffect='move';li.classList.add('queue-drop');};
        li.ondragleave=()=>li.classList.remove('queue-drop');
        li.ondrop=event=>{
          event.preventDefault();event.stopPropagation();li.classList.remove('queue-drop');
          const from=Number(event.dataTransfer.getData('text/plain'));
          if(Number.isInteger(from))run('reorder',{from,to:index});
        };
        li.ondragend=()=>panel.querySelectorAll('.queue-drop').forEach(row=>row.classList.remove('queue-drop'));
        const menu=document.createElement('details');menu.className='queue-menu';
        const summary=document.createElement('summary');FocusedIcons.set(summary,'more','More options for '+entry.title);
        summary.setAttribute('role','button');summary.setAttribute('aria-expanded','false');
        const actions=document.createElement('div');actions.className='queue-menu-actions';
        const remove=document.createElement('button');remove.type='button';remove.textContent='Remove from queue';
        remove.setAttribute('aria-label','Remove '+entry.title+' from queue');
        remove.onclick=()=>run('remove',{index});
        const up=document.createElement('button');up.type='button';up.textContent='Move up';up.disabled=index===current.index+1;
        up.onclick=()=>run('reorder',{from:index,to:index-1});
        const down=document.createElement('button');down.type='button';down.textContent='Move down';down.disabled=index===current.entries.length-1;
        down.onclick=()=>run('reorder',{from:index,to:index+2});
        actions.append(up,down,remove);menu.append(summary,actions);li.append(menu);
        menu.addEventListener('toggle',()=>{
          summary.setAttribute('aria-expanded',String(menu.open));
          if(!menu.open)return;
          panel.querySelectorAll('.queue-menu[open]').forEach(other=>{if(other!==menu)other.open=false;});
          menu.classList.remove('queue-menu-above');
          if(actions.getBoundingClientRect().bottom>panel.getBoundingClientRect().bottom-8)menu.classList.add('queue-menu-above');
        });
      }
      return li;
    }
    panel.addEventListener('click',event=>{
      panel.querySelectorAll('.queue-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});
    });
    list.ondragover=event=>event.preventDefault();
    list.ondrop=event=>{
      event.preventDefault();const from=Number(event.dataTransfer.getData('text/plain'));
      if(Number.isInteger(from))run('reorder',{from,to:current.entries.length});
    };
    function update(state, revision = 0){
      current=state;
      const key=JSON.stringify([state?.sourceID,state?.index,state?.entries,revision]);
      if(key===signature){
        const glyph=now.querySelector('.queue-play');
        if(glyph)glyph.replaceChildren(FocusedIcons.create(state.playing?'pause':'play'));
        const track=now.querySelector('.queue-track'),entry=state?.entries?.[state.index];
        if(track && entry)track.setAttribute('aria-label',(state.playing?'Pause ':'Play ')+entry.title);
        return;
      }
      signature=key;const turn=++version;now.replaceChildren();list.replaceChildren();
      const entry=state?.entries?.[state.index];
      panel.querySelector('#queueNowSection').hidden=!entry;
      if(entry)now.append(row(entry,state.index,true,turn));
      const next=entry?state.entries.slice(state.index+1):[];
      const samePlaylist=next.length && next.every(song=>song.playlist===next[0].playlist);
      panel.querySelector('#queueNextLabel').textContent=samePlaylist?'Next from: '+next[0].playlist:'Next up';
      for(let i=(state?.index??-1)+1;i<(state?.entries?.length||0);i++)list.append(row(state.entries[i],i,false,turn));
      panel.querySelector('#queueEmpty').hidden=!!next.length;
    }
    return {update};
  }
};
