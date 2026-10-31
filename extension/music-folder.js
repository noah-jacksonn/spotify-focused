/* Shared with iOS: direct subfolders are playlists, audio files are tracks.
   Optional <audio filename>.json sidecars hold details and ordering. */
const MusicFolder = (() => {
  const supported = /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|opus|mp4|caf)$/i;
  const valid = (name) =>
    typeof name === 'string' && !!name && !name.startsWith('.') && !/[\/\\\x00-\x1f]/.test(name);
  const requireName = (name) => {
    if (!valid(name)) throw new Error('Choose a valid name without slashes.');
    return name;
  };
  const db = new Promise((resolve, reject) => {
    const open = indexedDB.open('unslopified-music-folder', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('library');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });

  async function store(method, key, data) {
    const tx = (await db).transaction('library', method === 'get' ? 'readonly' : 'readwrite');
    const table = tx.objectStore('library');
    const request = method === 'put' ? table.put(data, key) : table[method](key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || request.error);
    });
  }
  const selection = () => store('get', 'folder');
  async function connect(handle) {
    const previous = await selection();
    if (previous && (await previous.handle.isSameEntry(handle))) return previous;
    if (previous) await disconnect();
    const selected = { handle, id: crypto.randomUUID() };
    await store('put', 'folder', selected);
    return selected;
  }
  async function disconnect() {
    const tx = (await db).transaction('library', 'readwrite');
    tx.objectStore('library').clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  const cacheKey = (root, playlist, file) => JSON.stringify([root.id, playlist, file]);
  async function dir(root, name) {
    return root.handle.getDirectoryHandle(requireName(name));
  }
  async function readInfo(folder, file) {
    try {
      const sidecar = await folder.getFileHandle(requireName(file) + '.json');
      const info = JSON.parse(await (await sidecar.getFile()).text());
      if (!info || typeof info !== 'object' || Array.isArray(info)) throw Error('Invalid song details.');
      return info;
    } catch (error) {
      if (error.name === 'NotFoundError') return {};
      throw error;
    }
  }

  async function write(folder, name, bytes) {
    const file = await folder.getFileHandle(requireName(name), { create: true });
    const stream = await file.createWritable();
    try {
      await stream.write(bytes);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }
  async function archived(folder) {
    try {
      await folder.getFileHandle('Unslopified.archive.json');
      return true;
    } catch (error) {
      if (error.name === 'NotFoundError') return false;
      throw error;
    }
  }
  async function coverName(folder) {
    try {
      const recipe = JSON.parse(await (await (await folder.getFileHandle('cover.json')).getFile()).text());
      if (recipe.version === 1 && valid(recipe.renderedFile) && recipe.renderedFile.startsWith('cover-rendered-')) {
        await folder.getFileHandle(recipe.renderedFile);
        return recipe.renderedFile;
      }
    } catch { /* A recipe or its immutable image may still be arriving from iCloud. */ }
    try { await folder.getFileHandle('cover.jpg'); return 'cover.jpg'; }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  async function home(root, hidden = [], previous = []) {
    const summaries = [];
    for (const list of await scan(root)) {
      const { name } = list;
      if (hidden.includes(name)) continue;
      const folder = await dir(root, name);
      const artwork = ImportedArtwork.source(list);
      let coverFile;
      if (valid(artwork)) {
        try { coverFile = await (await folder.getFileHandle(artwork)).getFile(); }
        catch { /* An image may still be arriving from iCloud. */ }
      }
      const entry = { name, count: list.songs.length };
      if (coverFile) {
        entry.coverRevision = [artwork, coverFile.size, coverFile.lastModified].join(':');
        const old = previous.find((p) => p.name === name && p.coverRevision === entry.coverRevision);
        if (old?.image) entry.image = old.image;
        else {
          try {
            const bitmap = await createImageBitmap(coverFile);
            const canvas = new OffscreenCanvas(128, 128);
            const side = Math.min(bitmap.width, bitmap.height);
            canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
            bitmap.close();
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            entry.image =
              'data:image/jpeg;base64,' + btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
          } catch {
            /* The cover may not have arrived from iCloud yet. */
          }
        }
      }
      summaries.push(entry);
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  async function scan(root) {
    const lists = [];
    for await (const [name, folder] of root.handle.entries()) {
      if (!valid(name) || folder.kind !== 'directory') continue;
      if (await archived(folder)) continue;
      const songs = [];
      const coverFile = await coverName(folder);
      for await (const [file, handle] of folder.entries()) {
        if (!valid(file) || handle.kind !== 'file' || !supported.test(file)) continue;
        const source = await handle.getFile();
        let info, warning;
        try {
          info = await readInfo(folder, file);
        } catch {
          info = {};
          warning = 'Unreadable song details';
        }
        const text = (key) => (typeof info[key] === 'string' ? info[key] : undefined);
        songs.push({
          file,
          title: text('title')?.trim() || file.replace(/\.[^.]+$/, ''),
          artist: text('artist')?.trim() || 'Unknown artist',
          importedAt: text('importedAt') || new Date(source.lastModified).toISOString(),
          createdAt: text('createdAt'),
          artworkFile: text('artworkFile'),
          sourceURL: text('sourceURL'),
          lyrics: text('lyrics'),
          order: Number.isFinite(info.order) ? info.order : undefined,
          warning
        });
      }
      songs.sort(
        (a, b) =>
          (a.order ?? Infinity) - (b.order ?? Infinity) ||
          Date.parse(b.importedAt) - Date.parse(a.importedAt) ||
          a.file.localeCompare(b.file)
      );
      lists.push({ name, songs, cover: !!coverFile, coverFile });
    }
    lists.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    await store('put', root.id + ':catalog', lists);
    return lists;
  }
  const lastScan = (root) => store('get', root.id + ':catalog');
  async function create(root, name) {
    requireName(name);
    let chosen = name;
    for (let suffix = 2; ; suffix++) {
      try {
        const existing = await root.handle.getDirectoryHandle(chosen);
        if (chosen === name && !await archived(existing)) throw new Error('A playlist with this name already exists.');
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
        return root.handle.getDirectoryHandle(chosen, { create: true });
      }
      chosen = name + ' (' + suffix + ')';
    }
  }
  function importFile(folder, file, metadata = {}) {
    return navigator.locks.request('import:' + folder.name, () => writeImport(folder, file, metadata));
  }
  async function durationMs(file) {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    try {
      const seconds = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Audio metadata timed out.')), 12000);
        audio.onloadedmetadata = () => {
          clearTimeout(timeout);
          resolve(audio.duration);
        };
        audio.onerror = () => {
          clearTimeout(timeout);
          reject(Error('Chrome could not read this audio file.'));
        };
        audio.preload = 'metadata';
        audio.src = url;
      });
      return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
    } finally {
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    }
  }
  function importInfo(metadata) {
    const info = {};
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return info;
    for (const key of ['title', 'artist', 'lyrics']) {
      if (typeof metadata[key] === 'string' && metadata[key].length <= 500000) info[key] = metadata[key];
    }
    if (typeof metadata.sourceURL === 'string') {
      try { if (new URL(metadata.sourceURL).protocol === 'https:') info.sourceURL = metadata.sourceURL; } catch {}
    }
    if (typeof metadata.createdAt === 'string' && Number.isFinite(Date.parse(metadata.createdAt))) info.createdAt = metadata.createdAt;
    return info;
  }
  async function writeImport(folder, file, metadata) {
    if (!valid(file.name) || !supported.test(file.name)) throw new Error('Unsupported audio file.');
    let inputBytes;
    const names = new Set();
    for await (const [name, handle] of folder.entries()) {
      names.add(name);
      if (handle.kind !== 'file' || !valid(name) || !supported.test(name)) continue;
      const existing = await handle.getFile();
      if (existing.size !== file.size) continue;
      inputBytes ??= new Uint8Array(await file.arrayBuffer());
      const other = new Uint8Array(await existing.arrayBuffer());
      if (other.every((byte, i) => byte === inputBytes[i])) return false;
    }
    const split = file.name.lastIndexOf('.');
    let name = file.name;
    const occupied = (candidate) => names.has(candidate) || names.has('.' + candidate + '.icloud');
    for (
      let suffix = 2;
      occupied(name) || occupied(name + '.json') || occupied(name + '.cover.jpg');
      suffix++
    ) {
      name = file.name.slice(0, split) + ' (' + suffix + ')' + file.name.slice(split);
    }
    const info = {
      title: file.name.slice(0, split),
      ...importInfo(metadata),
      durationMs: await durationMs(file).catch(() => undefined),
      importedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    };
    await write(folder, name + '.json', JSON.stringify(info));
    await write(folder, name, file);
    return true;
  }
  async function audio(root, playlist, file, { cache = false } = {}) {
    const key = cacheKey(root, playlist, file);
    let source;
    try {
      const folder = await dir(root, playlist);
      source = await (await folder.getFileHandle(requireName(file))).getFile();
    } catch (error) {
      const cached = await store('get', key);
      if (cached && error.name !== 'NotFoundError') return cached;
      throw error;
    }
    if (!cache) return source;
    const bytes = await new Response(source).blob();
    await store('put', key, bytes);
    return bytes;
  }
  async function update(root, playlist, file, changes, shouldWrite = () => true) {
    return navigator.locks.request('metadata:' + JSON.stringify([root.id, playlist, file]), async () => {
      const folder = await dir(root, playlist);
      await folder.getFileHandle(requireName(file));
      const info = await readInfo(folder, file);
      if (!shouldWrite(info)) return false;
      await write(folder, file + '.json', JSON.stringify({ ...info, ...changes }));
      return true;
    });
  }
  async function presentation(root, entry) {
    const seed = entry.playlist + '/' + entry.file;
    const gradient = await ImportedArtwork.gradient(seed);
    const hue = Number(gradient.match(/hsl\(([^ ]+)/)?.[1]) || 0;
    const result = {gradient, color:`hsl(${hue} 20% 25%)`};
    try {
      const folder = await dir(root, entry.playlist);
      const info = await readInfo(folder, entry.file);
      if (!valid(info.artworkFile)) return result;
      const file = await (await folder.getFileHandle(info.artworkFile)).getFile();
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = new OffscreenCanvas(128,128), context = canvas.getContext('2d');
        const side = Math.min(bitmap.width,bitmap.height);
        context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,128,128);
        const pixels = context.getImageData(0,0,128,128).data;
        let red=0,green=0,blue=0;
        for(let i=0;i<pixels.length;i+=4){red+=pixels[i];green+=pixels[i+1];blue+=pixels[i+2];}
        const count = pixels.length/4;
        result.color=`rgb(${[red,green,blue].map(sum=>Math.round(sum/count*.55)).join(' ')})`;
        const blob = await canvas.convertToBlob({type:'image/jpeg',quality:.85});
        result.image='data:image/jpeg;base64,'+btoa(Array.from(new Uint8Array(await blob.arrayBuffer()),byte=>String.fromCharCode(byte)).join(''));
      } finally { bitmap.close(); }
    } catch { /* An artwork file may not have arrived from iCloud yet. */ }
    return result;
  }
  return {
    selection,
    connect,
    disconnect,
    valid,
    home,
    scan,
    lastScan,
    dir,
    write,
    create,
    importFile,
    importInfo,
    audio,
    update,
    presentation,
    supported,
    coverName
  };
})();
