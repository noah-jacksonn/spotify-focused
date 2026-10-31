/* Portable cover recipe: exactly the same viewport-relative coordinates as iOS. */
const SharedCover = (() => {
  function constrain(crop, width, height) {
    const zoom = Math.min(6, Math.max(1, Number.isFinite(crop.zoom) ? crop.zoom : 1));
    const shortest = Math.max(1, Math.min(width, height));
    const limitX = Math.max(0, (width / shortest * zoom - 1) / 2);
    const limitY = Math.max(0, (height / shortest * zoom - 1) / 2);
    return {zoom, x: Math.max(-limitX, Math.min(limitX, crop.x || 0)), y: Math.max(-limitY, Math.min(limitY, crop.y || 0))};
  }
  function rect(crop, width, height, side) {
    crop = constrain(crop, width, height);
    const factor = side / Math.max(1, Math.min(width, height)) * crop.zoom;
    return {x: (side - width * factor) / 2 + crop.x * side, y: (side - height * factor) / 2 + crop.y * side,
      width: width * factor, height: height * factor};
  }
  function validRecipe(recipe) {
    return recipe?.version === 1 && ['zoom', 'x', 'y'].every(key => Number.isFinite(recipe.crop?.[key])) &&
      recipe.crop.zoom >= 1 && recipe.crop.zoom <= 6 &&
      [['originalFile', 'cover-original-'], ['previewFile', 'cover-source-'], ['renderedFile', 'cover-rendered-']].every(([key, prefix]) =>
        typeof recipe[key] === 'string' && recipe[key].startsWith(prefix) && MusicFolder.valid(recipe[key]));
  }
  async function file(folder, name) { return (await folder.getFileHandle(name)).getFile(); }
  async function read(folder) {
    let recipe;
    try { recipe = JSON.parse(await (await file(folder, 'cover.json')).text()); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (recipe) {
      if (!validRecipe(recipe)) throw Error('The saved crop could not be read.');
      const [original, preview] = await Promise.all([file(folder, recipe.originalFile), file(folder, recipe.previewFile)]);
      return {original, preview, originalExtension: recipe.originalFile.split('.').pop(), crop: recipe.crop};
    }
    try {
      const original = await file(folder, 'cover.jpg');
      return {original, preview: original, originalExtension: 'jpg', crop: {zoom:1,x:0,y:0}};
    } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  async function digest(blob) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function save(folder, result) {
    const ext = ['jpg','jpeg','png','heic','heif','webp','avif','gif','tif','tiff','bmp'].includes(result.originalExtension) ? result.originalExtension : 'bin';
    const originalFile = 'cover-original-' + await digest(result.original) + '.' + ext;
    const previewFile = 'cover-source-' + await digest(result.preview) + '.jpg';
    const renderedFile = 'cover-rendered-' + await digest(result.jpeg) + '.jpg';
    // Publish immutable assets before the recipe. Re-cropping reuses the same original.
    for (const [name, blob] of [[originalFile,result.original], [previewFile,result.preview], [renderedFile,result.jpeg]]) {
      try { await folder.getFileHandle(name); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; await MusicFolder.write(folder, name, blob); }
    }
    await MusicFolder.write(folder, 'cover.jpg', result.jpeg);
    await MusicFolder.write(folder, 'cover.json', JSON.stringify({version:1,originalFile,previewFile,renderedFile,crop:result.crop}));
  }
  function jpeg(canvas, quality = 0.9) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not prepare the cover.')), 'image/jpeg', quality));
  }
  async function prepare(original) {
    const image = await createImageBitmap(original);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return {original, originalExtension: (original.name || '').split('.').pop().toLowerCase(), preview: await jpeg(canvas, 0.94), crop:{zoom:1,x:0,y:0}};
    } finally { image.close(); }
  }
  // One modal instance. Each invocation owns its source and destination callback.
  let opened = false;
  async function open({folder, initialFile, initialEdit, onSave}) {
    if (opened) return;
    opened = true;
    const $ = id => document.getElementById(id);
    const dialog = $('coverDialog'), canvas = $('coverCanvas'), context = canvas.getContext('2d');
    let edit = null, image = null, crop = {zoom:1,x:0,y:0}, drag = null, busy = false, generation = 0;
    const status = message => { $('coverStatus').textContent = message || ''; $('coverStatus').hidden = !message; };
    const setBusy = value => {
      busy = value;
      dialog.setAttribute('aria-busy', String(value));
      $('saveCover').disabled = value || !image;
      $('chooseCover').disabled = $('coverZoom').disabled = $('resetCover').disabled = value;
      $('closeCover').disabled = value;
    };
    function draw() {
      context.fillStyle = '#121923'; context.fillRect(0,0,canvas.width,canvas.height);
      if (!image) return;
      crop = constrain(crop, image.width, image.height);
      const box = rect(crop, image.width, image.height, canvas.width);
      context.drawImage(image, box.x, box.y, box.width, box.height);
      $('coverZoom').value = crop.zoom;
    }
    async function load(next) {
      const turn = ++generation;
      setBusy(true); status('');
      try {
        const decoded = await createImageBitmap(next.preview);
        if (turn !== generation || !dialog.open) { decoded.close(); return; }
        image?.close(); image = decoded; edit = next; crop = {...next.crop}; draw();
      } finally { if (turn === generation) setBusy(false); }
    }
    const close = () => { if (!busy) dialog.close(); };
    $('closeCover').onclick = close;
    dialog.oncancel = event => { if (busy) event.preventDefault(); };
    dialog.onclose = () => { generation++; image?.close(); opened = false; $('coverFile').value = ''; };
    $('chooseCover').onclick = () => $('coverFile').click();
    $('coverFile').onchange = async () => {
      const chosen = $('coverFile').files[0]; $('coverFile').value = '';
      if (!chosen) return;
      setBusy(true);
      try { await load(await prepare(chosen)); } catch { status('Could not open this photo. Try a JPEG or PNG.'); }
      finally { setBusy(false); }
    };
    $('coverZoom').oninput = () => { crop.zoom = Number($('coverZoom').value); draw(); };
    $('resetCover').onclick = () => { crop = {zoom:1,x:0,y:0}; draw(); };
    canvas.onpointerdown = event => {
      if (busy || !image) return;
      drag = {x:event.clientX,y:event.clientY,crop:{...crop}}; canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = event => {
      if (!drag) return;
      const side = canvas.getBoundingClientRect().width;
      crop = {...crop, x:drag.crop.x + (event.clientX - drag.x) / side, y:drag.crop.y + (event.clientY - drag.y) / side}; draw();
    };
    canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
    canvas.onwheel = event => {
      if (busy || !image) return;
      event.preventDefault(); crop.zoom *= Math.exp(-event.deltaY * 0.001); draw();
    };
    canvas.onkeydown = event => {
      const offsets = {ArrowLeft:[-0.02,0], ArrowRight:[0.02,0], ArrowUp:[0,-0.02], ArrowDown:[0,0.02]};
      if (!image || busy || !offsets[event.key]) return;
      event.preventDefault(); crop.x += offsets[event.key][0]; crop.y += offsets[event.key][1]; draw();
    };
    $('saveCover').onclick = async () => {
      if (busy || !image || !edit) return;
      setBusy(true); status('');
      try {
        const output = document.createElement('canvas'); output.width = output.height = 640;
        const box = rect(crop, image.width, image.height, 640), ctx = output.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0,0,640,640); ctx.drawImage(image, box.x, box.y, box.width, box.height);
        await onSave({...edit,crop:{...crop},jpeg:await jpeg(output)});
        setBusy(false); dialog.close();
      } catch (error) { status(error.message || 'Could not save the cover.'); setBusy(false); }
    };
    status(''); draw(); dialog.showModal(); setBusy(true);
    try {
      const existing = initialFile ? await prepare(initialFile) : initialEdit || (folder ? await read(folder) : null);
      if (existing) await load(existing);
      else { setBusy(false); $('coverFile').click(); }
    } catch { status('Could not load the original. Let iCloud finish downloading, then reopen this editor.'); }
    finally { setBusy(false); }
  }
  return {constrain, rect, validRecipe, read, save, prepare, open};
})();
