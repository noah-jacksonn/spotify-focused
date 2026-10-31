/* Shared imported-audio player for the Spotify shell and the library page. */
globalThis.ImportedPlayerView = {
  mount(element, { prefix = '', command, openTrack, openLyrics, openQueue }) {
    element.classList.add('imported-player');
    const refs = {};
    let current, rememberedVolume = 1, artKey;
    function node(tag, name, parent, className = '') {
      const el = document.createElement(tag);
      el.id = prefix + name;
      el.className = className;
      refs[name] = el;
      parent.append(el);
      return el;
    }
    const run = (action, extra = {}) => Promise.resolve(command(action, extra)).catch(() => {});
    function button(name, icon, label, parent, click) {
      const el = node('button', name, parent, 'player-button');
      el.type = 'button';
      FocusedIcons.set(el, icon, label);
      el.addEventListener('click', click);
      return el;
    }
    const track = node('div', 'playerTrack', element, 'player-track');
    const art = button('playerArt', 'play', 'Open playing song', track, openTrack);
    art.className = 'player-art'; art.replaceChildren();
    const copy = node('div', 'playerCopy', track, 'player-copy');
    const title = node('button', 'now', copy, 'player-title');
    title.type = 'button'; title.onclick = openTrack;
    node('small', 'artist', copy);
    const center = node('div', 'playerCenter', element, 'player-center');
    const transport = node('div', 'playerTransport', center, 'player-transport');
    button('playerShuffle', 'shuffle', 'Enable shuffle', transport, () => run('shuffle'));
    button('prev', 'previous', 'Previous song', transport, () => run('previous'));
    button('toggle', 'play', 'Play', transport, () => run(current?.playing ? 'pause' : 'resume'));
    button('next', 'next', 'Next song', transport, () => run('next'));
    button('playerRepeat', 'repeat', 'Enable repeat', transport, () => run('repeat'));
    const progress = node('div', 'playerProgress', center, 'player-progress');
    node('span', 'elapsed', progress, 'player-time');
    const position = node('input', 'position', progress, 'player-range');
    Object.assign(position, {type:'range',min:'0',max:'0',step:'0.1'});
    position.setAttribute('aria-label','Song position');
    position.oninput = () => {
      refs.elapsed.textContent = time(Number(position.value));
      fill(position);
    };
    position.onchange = () => run('seek', {position:Number(position.value)});
    node('span', 'remaining', progress, 'player-time');
    const tools = node('div', 'playerTools', element, 'player-tools');
    button('lyricsButton', 'lyrics', 'Lyrics', tools, openLyrics);
    button('queueButton', 'queue', 'Queue', tools, openQueue);
    button('mute', 'volume', 'Mute', tools, () => {
      const volume = current?.volume ?? 1;
      if (volume > 0) rememberedVolume = volume;
      run('volume', {volume: volume > 0 ? 0 : rememberedVolume});
    });
    const volume = node('input', 'volume', tools, 'player-range player-volume');
    Object.assign(volume, {type:'range',min:'0',max:'1',step:'0.01',value:'1'});
    volume.setAttribute('aria-label','Volume');
    volume.oninput = () => { fill(volume); run('volume', {volume:Number(volume.value)}); };
    button('fullscreen', 'fullscreen', 'Full screen', tools, () => {
      const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      Promise.resolve(action).catch(() => {});
    });
    const fullscreenChanged = () => FocusedIcons.set(refs.fullscreen, 'fullscreen', document.fullscreenElement ? 'Exit full screen' : 'Full screen');
    document.addEventListener('fullscreenchange', fullscreenChanged);
    function time(value) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0));
      return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2,'0');
    }
    function fill(input) {
      input.style.setProperty('--fill', (Number(input.value) / (Number(input.max) || 1) * 100) + '%');
    }
    function update(state) {
      current = state;
      const entry = state?.entries?.[state.index];
      element.hidden = !entry;
      if (!entry) return;
      refs.now.textContent = entry.title;
      refs.artist.textContent = entry.artist;
      FocusedIcons.set(refs.toggle, state.playing ? 'pause' : 'play', state.playing ? 'Pause' : 'Play');
      FocusedIcons.set(refs.playerShuffle, 'shuffle', state.shuffle ? 'Disable shuffle' : 'Enable shuffle');
      refs.playerShuffle.setAttribute('aria-pressed', String(!!state.shuffle));
      FocusedIcons.set(refs.playerRepeat, state.repeat === 'one' ? 'repeatOne' : 'repeat', state.repeat === 'off' || !state.repeat ? 'Enable repeat' : state.repeat === 'all' ? 'Repeat one song' : 'Disable repeat');
      refs.playerRepeat.setAttribute('aria-pressed', String(!!state.repeat && state.repeat !== 'off'));
      refs.prev.disabled = state.index <= 0 && !(state.position > 3);
      refs.next.disabled = state.index >= state.entries.length - 1 && state.repeat !== 'all';
      position.max = state.duration || 0;
      if (document.activeElement !== position) position.value = state.position || 0;
      refs.elapsed.textContent = time(position.value);
      refs.remaining.textContent = '-' + time((state.duration || 0) - Number(position.value));
      fill(position);
      if (document.activeElement !== volume) volume.value = state.volume ?? 1;
      fill(volume);
      FocusedIcons.set(refs.mute, Number(volume.value) ? 'volume' : 'muted', Number(volume.value) ? 'Mute' : 'Unmute');
      const key = entry.playlist + '/' + entry.file;
      if (key !== artKey) {
        artKey = key;
        ImportedArtwork.gradient(key).then(gradient => { if (artKey === key && !current?.artwork?.image) art.style.backgroundImage = gradient; });
      }
      if (state.artwork?.image) art.style.backgroundImage = 'url("' + state.artwork.image + '")';
    }
    return { update, refs, dispose() { document.removeEventListener('fullscreenchange', fullscreenChanged); } };
  }
};
