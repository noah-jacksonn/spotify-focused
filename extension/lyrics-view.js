globalThis.ImportedLyrics = {
  mount(section, { seek, close }) {
    const view = section.querySelector('#lyricsText');
    const scroll = section.querySelector('#lyricsScroll');
    const follow = section.querySelector('#followLyrics');
    FocusedIcons.set(follow, 'follow', 'Follow lyrics');
    let signature, rows = [], current = -2, following = true;
    function followCurrent() {
      if (section.hidden || !following) return;
      const row = rows[Math.max(0,current)];
      row?.el.scrollIntoView?.({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }
    function setFollowing(value) {
      following = value;
      follow.setAttribute('aria-pressed', String(value));
    }
    follow.onclick = () => { setFollowing(!following); followCurrent(); };
    section.querySelector('#closeLyrics').onclick = close;
    for (const event of ['wheel','touchstart','pointerdown']) scroll.addEventListener(event, () => setFollowing(false), {passive:true});
    scroll.addEventListener('keydown', event => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)) setFollowing(false);
      if (event.key === 'Escape') close();
    });
    setFollowing(true);
    function update(song, entry, position = 0) {
      section.querySelector('#lyricsPlaylist').textContent = entry?.playlist || 'Lyrics';
      const words = song?.lyrics || '';
      const key = JSON.stringify([entry?.playlist,entry?.file,words]);
      if (key !== signature) {
        signature = key; current = -2; rows = [];
        setFollowing(true); view.replaceChildren();
        for (const line of words.split(/\r?\n/)) {
          const matches = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
          for (const match of matches) rows.push({time:60*Number(match[1])+Number(match[2]),text:line.slice(matches.at(-1).index+matches.at(-1)[0].length).trim()});
        }
        rows.sort((a,b)=>a.time-b.time);
        const timed = !!rows.length;
        if (!timed) rows = words.split(/\r?\n/).filter(line=>line.trim()).map(text=>({text}));
        follow.hidden = !timed;
        if (!rows.length) {
          const message=document.createElement('p');message.className='lyrics-empty';message.textContent='No lyrics saved for this song.';view.append(message);
        }
        for (const row of rows) {
          row.el=document.createElement(timed?'button':'div');row.el.className='lyric-line';row.el.textContent=row.text || '♪';
          if (timed) {
            row.el.type='button';
            row.el.onclick=()=>{setFollowing(true);Promise.resolve(seek(row.time)).catch(()=>{});};
          } else row.el.dataset.phase='plain';
          view.append(row.el);
        }
      }
      const active = rows.findLastIndex(row=>row.time!==undefined && row.time<=position);
      if (active !== current) {
        current=active;
        rows.forEach((row,index)=>{
          if(row.time===undefined)return;
          row.el.dataset.phase=index<active?'past':index===active?'current':'upcoming';
          if(index===active)row.el.setAttribute('aria-current','true');else row.el.removeAttribute('aria-current');
        });
        followCurrent();
      }
    }
    return { update, opened() { followCurrent(); } };
  }
};
