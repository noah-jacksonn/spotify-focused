(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const icon = globalThis.FocusedIcons.set;
  const playerView = ImportedPlayerView.mount($('player'), {
    command: (action, extra) => act(() => cmd(action, extra))(),
    openTrack: () => {
      setLyricsOpen(false);
      const entry = state?.entries?.[state.index];
      if (entry) location.hash = encodeURIComponent(entry.playlist);
    },
    openLyrics: () => setLyricsOpen($('lyricsPage').hidden),
    openQueue
  });
  const lyricsView = ImportedLyrics.mount($('lyricsPage'), {
    seek: position => act(() => cmd('seek', {position}))(),
    close: () => setLyricsOpen(false)
  });
  const queueView = ImportedQueue.mount($('queuePanel'), {
    command: (action, extra) => act(() => cmd(action, extra))(),
    artwork: entry => root ? MusicFolder.presentation(root, entry) : Promise.resolve(null)
  });
  for (const [id, name, label] of [
    ['play', 'play', 'Play playlist'], ['shuffle', 'shuffle', 'Shuffle playlist'],
    ['create', 'add', 'Create playlist'],
    ['closeQueue', 'close', 'Close queue'], ['closeLyrics', 'close', 'Close lyrics'],
    ['closeCreate', 'close', 'Close'], ['closeEditor', 'close', 'Close'], ['closeCover', 'close', 'Close'],
    ['closeFolder', 'close', 'Close'], ['back', 'back', 'Back to Spotify'], ['refresh', 'refresh', 'Refresh library']
  ]) icon($(id), name, label);
  icon(document.querySelector('#detail .tools summary'), 'more', 'Playlist options');
  icon(document.querySelector('#dates summary'), 'calendar', 'Filter by date');
  document.addEventListener('click', event => {
    document.querySelectorAll('.playlist-menu[open]').forEach(menu => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.playlist-menu[open]').forEach(menu => {
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  });
  const report = (message, {quiet = false} = {}) => {
    const dialogStatus = quiet ? null : document.querySelector('dialog[open] .dialogStatus');
    if (message && !quiet && !dialogStatus && document.body.matches('.showing-lyrics, .showing-queue')) { lyricsToast(message); return; }
    const status = dialogStatus || $('notice');
    status.textContent = message || '';
    status.hidden = !message;
  };
  let toastTimer;
  function lyricsToast(message) {
    clearTimeout(toastTimer);
    $('lyricsToast').textContent = message;
    $('lyricsToast').hidden = false;
    toastTimer = setTimeout(() => { $('lyricsToast').hidden = true; }, 6500);
  }
  const act =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args);
      } catch (error) {
        if (error.name !== 'AbortError') report(error.message);
      }
    };
  let root,
    lists = [],
    active,
    editing,
    state,
    generation = 0,
    artworkGeneration = 0;
  let hidden = [],
    objectURLs = [];
  const current = () => lists.find((list) => list.name === active);
  const button = (text, click) => {
    const el = document.createElement('button');
    el.textContent = text;
    el.onclick = act(click);
    return el;
  };
  const hiddenKey = () => 'importedHidden:' + root.id;
  async function permission(write = false, source = root, request = false) {
    const descriptor = { mode: write ? 'readwrite' : 'read' };
    if (
      (await source.handle.queryPermission(descriptor)) !== 'granted' &&
      (!request || (await source.handle.requestPermission(descriptor)) !== 'granted')
    ) {
      $('reconnect').hidden = false;
      throw Error(write ? 'Reconnect folder to allow edits.' : 'Reconnect folder to continue.');
    }
  }
  function visible() {
    const from = $('from').value,
      to = $('through').value;
    return (current()?.songs || []).filter((song) => {
      if (!from && !to) return true;
      const day = song.createdAt?.slice(0, 10);
      return day && (!from || day >= from) && (!to || day <= to);
    });
  }
  async function refresh() {
    const turn = ++generation;
    const selected = await MusicFolder.selection();
    if (turn !== generation) return;
    root = selected;
    $('connected').hidden = !root;
    $('setup').hidden = !!root;
    $('refresh').hidden = !root;
    $('connect').textContent = root ? 'Change library' : 'Choose library';
    $('folderName').textContent = root?.handle.name || 'No folder connected';
    $('disconnect').hidden = !root;
    $('reconnect').hidden = true;
    if (!root) {
      lists = [];
      return;
    }
    let catalog;
    try {
      if ((await root.handle.queryPermission({ mode: 'read' })) !== 'granted') {
        $('reconnect').hidden = false;
        throw Error('Folder access expired.');
      }
      const writable = (await root.handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      catalog = await MusicFolder.scan(root);
      if (turn === generation) {
        $('reconnect').hidden = writable;
        report(writable ? '' : 'Reconnect folder to allow edits.', {quiet:true});
      }
    } catch (error) {
      catalog = (await MusicFolder.lastScan(root)) || [];
      if (turn === generation) report(error.message, {quiet:true});
    }
    if (turn !== generation) return;
    lists = catalog;
    const saved = await chrome.storage.local.get(hiddenKey());
    if (turn !== generation) return;
    hidden = saved[hiddenKey()] || [];
    await chrome.runtime.sendMessage({ type: 'imported:refresh' });
    const target = decodeURIComponent(location.hash.slice(1));
    active = lists.some((list) => list.name === target) ? target : lists[0]?.name;
    await render();
    void paintPlayerArtwork();
    if (!$('lyricsPage').hidden) renderLyrics();
    if (!$('queuePanel').hidden) renderQueue();
  }
  async function cover(el, folder, name, seed, version) {
    const gradient = await ImportedArtwork.gradient(seed);
    if (version !== artworkGeneration) return;
    el.style.backgroundImage = gradient;
    if (!name || !MusicFolder.valid(name)) return;
    try {
      const file = await (await folder.getFileHandle(name)).getFile();
      if (version !== artworkGeneration) return;
      const url = URL.createObjectURL(file);
      objectURLs.push(url);
      el.style.backgroundImage = 'url("' + url + '"), ' + gradient;
    } catch {
      /* A remote cover may still be downloading. */
    }
  }
  async function render() {
    const version = ++artworkGeneration;
    objectURLs.forEach(URL.revokeObjectURL);
    objectURLs = [];
    const nav = $('playlists');
    nav.replaceChildren();
    for (const list of lists) {
      const item = button(list.name, () => {
        location.hash = encodeURIComponent(list.name);
      });
      item.setAttribute('aria-current', String(list.name === active));
      nav.append(item);
    }
    const list = current();
    $('detail').hidden = !list;
    if (!list) {
      nav.textContent = 'Create a playlist to add songs.';
      return;
    }
    $('title').textContent = list.name;
    $('home').textContent = hidden.includes(active) ? 'Show on Home' : 'Hide from Home';
    const folder = await MusicFolder.dir(root, active).catch(() => null);
    if (version !== artworkGeneration) return;
    void cover(
      $('playlistArt'),
      folder,
      ImportedArtwork.source(list),
      active,
      version
    );
    const ol = $('songs');
    ol.replaceChildren();
    const songs = visible();
    $('play').disabled = $('shuffle').disabled = !songs.length;
    if (!songs.length)
      ol.textContent = list.songs.length
        ? 'No songs in this date range.'
        : 'Drop audio files here or choose Import songs.';
    for (const song of songs) {
      const li = document.createElement('li');
      li.className = 'row';
      const art = document.createElement('span');
      art.className = 'art';
      const copy = document.createElement('span');
      copy.className = 'copy';
      const title = document.createElement('strong');
      title.textContent = song.title;
      const artist = document.createElement('small');
      artist.textContent = song.artist;
      copy.append(title, artist);
      const track = button('', () => play(songs, songs.indexOf(song)));
      track.className = 'track';
      track.append(art, copy);
      const edit = button('···', () => editSong(song));
      icon(edit, 'more', 'Details for ' + song.title);
      const enqueue = button('＋', () => {
        if (!state?.entries?.length || state.sourceID !== root.id)
          throw Error('Play an imported song first to add to its queue.');
        return cmd('enqueue', {
          entry: { playlist: active, file: song.file, title: song.title, artist: song.artist }
        });
      });
      icon(enqueue, 'add', 'Add ' + song.title + ' to queue');
      li.append(track, enqueue, edit);
      ol.append(li);
      void cover(art, folder, song.artworkFile, list.name + '/' + song.file, version);
    }
  }
  async function cmd(action, extra = {}) {
    const result = await chrome.runtime.sendMessage({ type: 'imported:command', cmd: { action, ...extra } });
    if (!result?.ok) throw Error(result?.error || 'Could not control playback.');
    if (result.state) display(result.state);
  }
  function play(songs, index = 0, shuffle = false) {
    return cmd('play', {
      sourceID: root.id,
      index,
      shuffle,
      shuffleStart: shuffle,
      entries: songs.map((song) => ({
        playlist: active,
        file: song.file,
        title: song.title,
        artist: song.artist
      }))
    });
  }
  function display(next) {
    state = next;
    playerView.update(state);
    if (!state?.entries?.[state.index]) return;
    if (state.artwork?.color) $('lyricsPage').style.setProperty('--lyrics-color', state.artwork.color);
    void paintPlayerArtwork();
    if (!$('queuePanel').hidden) renderQueue();
    if (!$('lyricsPage').hidden) renderLyrics();
  }
  let playerArtworkKey, playerArtworkVersion = 0;
  async function paintPlayerArtwork() {
    const entry = state?.entries?.[state.index];
    if (!entry || !root) return;
    const key = JSON.stringify([root.id,entry.playlist,entry.file,artworkGeneration]);
    if (playerArtworkKey === key) return;
    playerArtworkKey = key;
    const turn = ++playerArtworkVersion;
    try {
      const artwork = await MusicFolder.presentation(root, entry);
      if (turn !== playerArtworkVersion) return;
      playerView.update({...state,artwork});
      $('lyricsPage').style.setProperty('--lyrics-color', artwork.color);
    } catch { /* Keep the gradient while a remote image is downloading. */ }
  }
  function renderQueue() { queueView.update(state, artworkGeneration); }
  function renderLyrics() {
    const entry = state?.entries?.[state.index];
    const song = lists.find(list => list.name === entry?.playlist)?.songs.find(song => song.file === entry.file);
    lyricsView.update(song, entry, state?.position || 0);
  }
  function setLyricsOpen(open) {
    $('lyricsPage').hidden = !open;
    document.body.classList.toggle('showing-lyrics', open);
    document.querySelector('main').inert = open;
    $('lyricsButton').setAttribute('aria-pressed', String(open));
    const url = new URL(location.href);
    if (open) url.searchParams.set('view','lyrics');
    else if (url.searchParams.get('view') === 'lyrics') url.searchParams.delete('view');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (open) { renderLyrics(); lyricsView.opened(); }
    else $('lyricsButton').focus();
  }
  function setQueueOpen(open) {
    $('queuePanel').hidden = !open;
    document.body.classList.toggle('showing-queue', open);
    $('queueButton').setAttribute('aria-pressed', String(open));
    const url = new URL(location.href);
    if (open) url.searchParams.set('queue', '1'); else url.searchParams.delete('queue');
    if (url.searchParams.get('view') === 'queue') url.searchParams.delete('view');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (open) renderQueue();
    else $('queueButton').focus();
    if (!$('lyricsPage').hidden) lyricsView.opened();
  }
  function openQueue() { setQueueOpen($('queuePanel').hidden); }
  $('closeQueue').onclick = () => setQueueOpen(false);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    const menu = $('queuePanel').querySelector('.queue-menu[open]');
    if (menu) { event.stopImmediatePropagation(); menu.open = false; menu.querySelector('summary').focus(); return; }
    if (!$('queuePanel').hidden) { event.stopImmediatePropagation(); setQueueOpen(false); }
    else if (!$('lyricsPage').hidden) setLyricsOpen(false);
  }, true);
  async function importFiles(files) {
    const folder = await MusicFolder.dir(root, active);
    let added = 0;
    let linked = 0;
    const failures = [];
    for (const file of files) {
      if (file.name.endsWith('.json')) continue;
      try {
        const sidecar = files.find(candidate => candidate.name === file.name + '.json');
        const metadata = sidecar ? JSON.parse(await sidecar.text()) : {};
        if (await MusicFolder.importFile(folder, file, metadata)) {
          added++;
          if (typeof metadata.sourceURL === 'string') linked++;
        }
      } catch (error) {
        failures.push(file.name + ': ' + error.message);
      }
    }
    await refresh();
    report('Imported ' + added + ' songs.' + (failures.length ? ' ' + failures.join(' · ') : ''));
    if (added) {
      if (!linked) lyricsToast('Add a Suno link in song details to fetch lyrics.');
      void chrome.runtime.sendMessage({ type: 'imported:lyrics-start' }).catch(() => {});
    }
  }
  async function jpeg(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 900;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas
        .getContext('2d')
        .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 900, 900);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw Error('Could not read this cover.');
      return blob;
    } finally {
      bitmap.close();
    }
  }
  async function editSong(song) {
    if (song.warning) throw Error(song.warning + '. Repair its JSON file before editing.');
    await permission(true);
    editing = { source: root, playlist: active, file: song.file, original: { ...song }, saving: Promise.resolve(), revision: 0 };
    $('songTitle').value = song.title;
    $('songArtist').value = song.artist;
    $('songDate').value = song.createdAt?.slice(0, 10) || '';
    $('songSource').value = song.sourceURL || '';
    $('songLyrics').value = song.lyrics || '';
    $('retryLyrics').hidden = !!song.lyrics?.trim() || !/^https:\/\/suno\.com\/song\//.test(song.sourceURL || '');
    $('songOrder').value = song.order ?? '';
    $('songArt').value = '';
    const status = $('editor').querySelector('.dialogStatus');
    status.textContent = '';
    status.hidden = true;
    $('editor').showModal();
  }
  $('connect').onclick = act(async () => {
    const handle = await showDirectoryPicker({ mode: 'readwrite', id: 'unslopified-music' });
    const selected = await MusicFolder.connect(handle);
    if (root && root.id !== selected.id) await cmd('clear');
    await refresh();
    $('folderDialog').close();
  });
  $('setupConnect').onclick = () => $('connect').click();
  $('closeFolder').onclick = () => $('folderDialog').close();
  $('folderDialog').addEventListener('close', () => {
    const url = new URL(location.href);
    url.searchParams.delete('folder');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  });
  $('back').onclick = act(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'imported:back' });
    if (!result?.ok) throw Error('Could not return to Spotify.');
  });
  function openFolderSettings() {
    if (new URLSearchParams(location.search).has('folder') && !$('folderDialog').open) $('folderDialog').showModal();
  }
  openFolderSettings();
  $('refresh').onclick = act(refresh);
  $('reconnect').onclick = act(async () => {
    await permission(true, root, true);
    await refresh();
  });
  $('disconnect').onclick = act(async () => {
    await cmd('clear');
    await MusicFolder.disconnect();
    await chrome.storage.local.remove('importedHome');
    await refresh();
    $('folderDialog').close();
  });
  let newCoverEdit = null;
  let newCoverURL;
  function setNewCover(result) {
    newCoverEdit = result;
    if (newCoverURL) URL.revokeObjectURL(newCoverURL);
    newCoverURL = URL.createObjectURL(result.jpeg);
    $('newCoverPreview').style.backgroundImage = 'url("' + newCoverURL + '")';
    $('newCoverPreview').hidden = false;
  }
  $('create').onclick = () => {
    newCoverEdit = null;
    $('newCoverPreview').hidden = true;
    if (newCoverURL) URL.revokeObjectURL(newCoverURL);
    newCoverURL = null;
    $('createForm').reset();
    $('createDialog').querySelector('.dialogStatus').textContent = '';
    $('newLocation').textContent = 'Saves to ' + root.handle.name + '.';
    $('createDialog').showModal();
  };
  $('closeCreate').onclick = () => $('createDialog').close();
  $('newCover').onchange = act(async () => {
    const file = $('newCover').files[0];
    $('newCover').value = '';
    if (!file) return;
    await SharedCover.open({initialFile:file, onSave: async result => { setNewCover(result); }});
  });
  $('newCoverPreview').onclick = act(() => SharedCover.open({initialEdit:newCoverEdit, onSave:async result => { setNewCover(result); }}));
  $('createForm').onsubmit = act(async (event) => {
    event.preventDefault();
    const name = $('newName').value.trim();
    await permission(true);
    const cover = newCoverEdit;
    const folder = await MusicFolder.create(root, name);
    $('createDialog').close();
    location.hash = encodeURIComponent(folder.name);
    try {
      if (cover) await SharedCover.save(folder, cover);
    } finally {
      await refresh();
    }
  });
  $('import').onclick = act(async () => {
    await permission(true);
    $('files').click();
  });
  $('files').onchange = act(async () => {
    const files = [...$('files').files];
    $('files').value = '';
    await importFiles(files);
  });
  $('detail').ondragover = (e) => {
    e.preventDefault();
    document.body.classList.add('drag');
  };
  $('detail').ondragleave = () => document.body.classList.remove('drag');
  $('detail').ondrop = act(async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag');
    const files = [...e.dataTransfer.files];
    await permission(true);
    await importFiles(files);
  });
  $('cover').onclick = act(async () => {
    await permission(true);
    const folder = await MusicFolder.dir(root, active);
    await SharedCover.open({folder, onSave: async result => {
      await SharedCover.save(folder, result);
      await refresh();
    }});
  });
  $('home').onclick = act(async () => {
    hidden = hidden.includes(active) ? hidden.filter((n) => n !== active) : [...hidden, active];
    await chrome.storage.local.set({ [hiddenKey()]: hidden });
    await refresh();
  });
  $('offline').onclick = act(async () => {
    for (const song of current().songs) await MusicFolder.audio(root, active, song.file, {cache:true});
    report('Playlist saved for offline playback.');
  });
  $('delete').onclick = act(async () => {
    if (!confirm('Archive “' + active + '” on all devices? The files will stay in its folder.')) return;
    await permission(true);
    await MusicFolder.write(
      await MusicFolder.dir(root, active),
      'Unslopified.archive.json',
      JSON.stringify({ archived: true })
    );
    if (state?.entries?.some((entry) => entry.playlist === active)) await cmd('clear');
    await refresh();
  });
  $('play').onclick = act(() => play(visible()));
  $('shuffle').onclick = act(() => {
    return play(visible(), 0, true);
  });
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing ||
        event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])') ||
        document.querySelector('#editor[open], #createDialog[open], #folderDialog[open], #coverDialog[open]')) return;
    if (!state?.entries?.[state.index] && !visible().length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) (state?.entries?.[state.index] ? $('toggle') : $('play')).click();
  }, true);
  function saveEditor(session = editing) {
    clearTimeout(session.timer);
    // Serialize writes and read the latest fields when each write starts.
    const save = session.saving.catch(() => {}).then(async () => {
      if (session !== editing) return;
      if (!$('editorForm').checkValidity()) throw Error('Check the highlighted fields before closing.');
      const { source, playlist, file, original } = session;
      const changes = {
        title: $('songTitle').value.trim(),
        artist: $('songArtist').value.trim() || 'Unknown artist',
        createdAt: $('songDate').value ? $('songDate').value + 'T12:00:00Z' : null,
        lyrics: $('songLyrics').value.trim() || null,
        sourceURL: $('songSource').value.trim() || null,
        order: $('songOrder').value === '' ? null : Number($('songOrder').value)
      };
      if (!changes.title || (changes.sourceURL && new URL(changes.sourceURL).protocol !== 'https:'))
        throw Error('Use a title and an HTTPS source link.');
      for (const key of ['title', 'artist', 'lyrics', 'sourceURL', 'order']) {
        if ((original[key] ?? null) === changes[key]) delete changes[key];
      }
      if ((original.createdAt?.slice(0, 10) || '') === $('songDate').value) delete changes.createdAt;
      const artwork = $('songArt').files[0];
      if (!Object.keys(changes).length && (!artwork || artwork === session.savedArtwork)) return;
      await permission(true, source);
      if (artwork && artwork !== session.savedArtwork) {
        changes.artworkFile = file + '.cover.jpg';
        await MusicFolder.write(await MusicFolder.dir(source, playlist), changes.artworkFile, await jpeg(artwork));
      }
      if (Object.keys(changes).length) await MusicFolder.update(source, playlist, file, changes);
      Object.assign(original, changes);
      session.savedArtwork = artwork;
      report('');
    });
    session.saving = save;
    return save;
  }
  function autosaveEditor(immediate = false) {
    const session = editing;
    if (!session) return;
    session.revision++;
    clearTimeout(session.timer);
    const save = () => saveEditor(session).catch(error => { if (editing === session) report(error.message); });
    if (immediate) void save();
    else session.timer = setTimeout(save, 500);
  }
  async function closeEditor() {
    const session = editing;
    if (!session || session.closing) return;
    session.closing = true;
    try {
      // If typing continues during a write, flush those newer edits too.
      let revision;
      do {
        revision = session.revision;
        await saveEditor(session);
      } while (revision !== session.revision);
      editing = null;
      $('editor').close();
      await refresh();
    } catch (error) {
      report(error.message);
      $('editorForm').reportValidity();
    } finally { session.closing = false; }
  }
  $('closeEditor').onclick = closeEditor;
  $('retryLyrics').onclick = act(async () => {
    await saveEditor();
    const result = await chrome.runtime.sendMessage({ type: 'imported:lyrics-retry', playlist: editing.playlist, file: editing.file });
    if (!result?.ok) throw Error('Could not retry lyrics.');
    await closeEditor();
  });
  $('editorForm').addEventListener('input', () => autosaveEditor());
  $('editorForm').addEventListener('change', () => autosaveEditor(true));
  $('editorForm').addEventListener('focusout', () => autosaveEditor(true));
  $('editorForm').onsubmit = (event) => { event.preventDefault(); autosaveEditor(true); };
  $('editor').addEventListener('cancel', event => { event.preventDefault(); void closeEditor(); });
  for (const dialog of document.querySelectorAll('dialog')) {
    let startedOutside = false;
    const outside = event => {
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    };
    dialog.addEventListener('pointerdown', event => { startedOutside = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => {
      if (startedOutside && event.target === dialog && outside(event)) {
        if (dialog.id === 'editor') void closeEditor();
        else if (dialog.getAttribute('aria-busy') !== 'true') dialog.close();
      }
      startedOutside = false;
    });
  }
  $('from').onchange = $('through').onchange = act(render);
  $('clearDates').onclick = act(() => {
    $('from').value = $('through').value = '';
    return render();
  });
  window.onhashchange = act(async () => {
    $('from').value = $('through').value = '';
    active = decodeURIComponent(location.hash.slice(1));
    await render();
  });
  window.onfocus = () => { if (!$('editor').open) void act(refresh)(); };
  setInterval(() => {
    if (root && !document.hidden && !$('editor').open) act(refresh)();
  }, 30000);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'imported:lyrics-notice') lyricsToast(msg.message);
    if (msg.type === 'imported:lyrics-updated') {
      lyricsToast('Lyrics added to ' + msg.count + (msg.count === 1 ? ' song.' : ' songs.'));
      if (!$('editor').open) void act(refresh)();
    }
    if (msg.type === 'imported:state') display(msg.state);
    if (msg.type === 'imported:progress' && state?.sourceID === msg.sourceID && state.index === msg.index) {
      display({ ...state, position: msg.position });
    }
    if (msg.type === 'imported:error') report(msg.message);
  });
  act(async () => {
    await refresh();
    const view = new URLSearchParams(location.search).get('view');
    if (view === 'lyrics') setLyricsOpen(true);
    if (view === 'queue' || new URLSearchParams(location.search).has('queue')) setQueueOpen(true);
  })();
  chrome.runtime
    .sendMessage({ type: 'imported:status' })
    .then((result) => display(result?.state))
    .catch((error) => report(error.message));
})();
