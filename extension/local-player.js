(() => {
  const audio = document.getElementById('audio');
  let entries = [],
    originalEntries = [],
    shuffle = false,
    repeat = 'off',
    artwork,
    index = -1,
    objectURL,
    serial = 0,
    sourceID;
  function snapshot() {
    return {
      entries,
      index,
      sourceID,
      originalEntries,
      shuffle,
      repeat,
      artwork,
      playing: !audio.paused,
      position: audio.currentTime || 0,
      volume: audio.volume,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0
    };
  }
  const publish = () =>
    chrome.runtime.sendMessage({ type: 'imported:state', state: snapshot() }).catch(() => {});
  let lastPublish = 0;
  audio.ontimeupdate = () => {
    if (Date.now() - lastPublish > 200) {
      lastPublish = Date.now();
      chrome.runtime
        .sendMessage({ type: 'imported:progress', index, sourceID, position: audio.currentTime || 0 })
        .catch(() => {});
    }
  };
  audio.onpause = audio.ondurationchange = publish;
  audio.onplaying = () => {
    publish();
    chrome.runtime.sendMessage({ type: 'imported:started' }).catch(() => {});
  };
  async function load(position, offset = 0) {
    const turn = ++serial;
    audio.pause();
    index = position;
    artwork = undefined;
    const entry = entries[index];
    if (!entry) {
      publish();
      return;
    }
    const root = await MusicFolder.selection();
    if (!root || root.id !== sourceID) throw new Error('Reconnect the library for this queue.');
    const file = await MusicFolder.audio(root, entry.playlist, entry.file);
    if (turn !== serial) return;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(file);
    audio.src = objectURL;
    audio.currentTime = offset;
    await audio.play();
    navigator.mediaSession.metadata = new MediaMetadata({
      title: entry.title,
      artist: entry.artist,
      album: entry.playlist
    });
    publish();
    const image = await MusicFolder.presentation(root, entry).catch(() => undefined);
    if (turn === serial) { artwork = image; publish(); }
  }
  function failed(error) {
    audio.pause();
    chrome.runtime
      .sendMessage({ type: 'imported:error', message: error.message || 'Audio playback failed.' })
      .catch(() => {});
    publish();
  }
  audio.onended = () => {
    if (repeat === 'one') load(index).catch(failed);
    else if (index + 1 < entries.length) load(index + 1).catch(failed);
    else if (repeat === 'all' && entries.length) load(0).catch(failed);
    else publish();
  };
  function reorder(start) {
    const next = entries.slice(start);
    if (shuffle) {
      for (let i=next.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1));[next[i],next[j]]=[next[j],next[i]]; }
    } else {
      const key = entry => entry.playlist+'\0'+entry.file;
      next.sort((a,b)=>originalEntries.findIndex(entry=>key(entry)===key(a))-originalEntries.findIndex(entry=>key(entry)===key(b)));
    }
    entries = [...entries.slice(0,start),...next];
  }
  audio.onerror = () => failed(new Error('Chrome could not decode this audio file.'));
  async function command(cmd) {
    switch (cmd.action) {
      case 'play':
        entries = cmd.entries;
        originalEntries = cmd.originalEntries || entries.slice();
        shuffle = cmd.shuffle ?? false;
        repeat = cmd.repeat || repeat;
        if (shuffle && !cmd.restoreOrder) reorder(cmd.shuffleStart ? 0 : cmd.index + 1);
        sourceID = cmd.sourceID;
        if (Number.isFinite(cmd.volume)) audio.volume = cmd.volume;
        await load(cmd.index, cmd.position || 0);
        break;
      case 'enqueue':
        entries.push(cmd.entry);
        originalEntries.push(cmd.entry);
        break;
      case 'remove':
        if (cmd.index > index && cmd.index < entries.length) entries.splice(cmd.index, 1);
        break;
      case 'reorder':
        if (Number.isInteger(cmd.from) && Number.isInteger(cmd.to) && cmd.from > index && cmd.from < entries.length && cmd.to > index && cmd.to <= entries.length) {
          const [entry]=entries.splice(cmd.from,1);
          entries.splice(cmd.to-(cmd.from<cmd.to?1:0),0,entry);
          originalEntries=entries.slice();
        }
        break;
      case 'pause':
        ++serial;
        audio.pause();
        break;
      case 'resume':
        await audio.play();
        break;
      case 'next':
        if (index + 1 < entries.length) await load(index + 1);
        else if (repeat === 'all' && entries.length) await load(0);
        break;
      case 'shuffle':
        shuffle = !shuffle;
        reorder(index + 1);
        break;
      case 'repeat':
        repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
        break;
      case 'previous':
        if (audio.currentTime > 3) audio.currentTime = 0;
        else await load(Math.max(0, index - 1));
        break;
      case 'seek':
        if (Number.isFinite(cmd.position)) audio.currentTime = Math.max(0, cmd.position);
        break;
      case 'volume':
        audio.volume = Math.max(0, Math.min(1, cmd.volume));
        break;
      case 'clear':
        ++serial;
        audio.pause();
        entries = [];
        originalEntries = [];
        artwork = undefined;
        index = -1;
        audio.removeAttribute('src');
        audio.load();
        if (objectURL) URL.revokeObjectURL(objectURL);
        objectURL = undefined;
        break;
    }
    publish();
    return snapshot();
  }
  for (const [key, action] of [
    ['play', 'resume'],
    ['pause', 'pause'],
    ['nexttrack', 'next'],
    ['previoustrack', 'previous']
  ]) {
    navigator.mediaSession.setActionHandler(key, () => command({ action }).catch(failed));
  }
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.target !== 'imported-player' || sender.id !== chrome.runtime.id) return;
    command(msg.cmd).then(
      (state) => reply({ ok: true, state }),
      (error) => {
        failed(error);
        reply({ ok: false, error: error.message });
      }
    );
    return true;
  });
})();
