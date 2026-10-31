(() => {
  'use strict';
  const C = globalThis.SpotifyFocusedCore;
  const toggle = document.getElementById('enabled');
  const status = document.getElementById('status');
  document.getElementById('libraryIcon').append(FocusedIcons.create('folder'));
  document.getElementById('libraryChevron').append(FocusedIcons.create('chevron'));
  MusicFolder.selection().then(root => {
    document.getElementById('libraryName').textContent = root?.handle.name || 'Choose folder';
  }).catch(() => { status.textContent = 'Could not load library settings.'; });
  document.getElementById('musicFolder').onclick = () => {
    chrome.runtime.sendMessage({ type: 'imported:open', settings: true }).then(result => {
      if (!result?.ok) status.textContent = 'Could not open library settings.';
    }).catch(() => { status.textContent = 'Could not open library settings.'; });
  };
  function render(state) {
    toggle.checked = state.enabled;
  }
  chrome.storage.local.get(C.STORAGE_KEY).then(result => {
    render(C.settings(result[C.STORAGE_KEY]));
    toggle.disabled = false;
  }).catch(() => { status.textContent = 'Could not load settings. Reopen this popup to try again.'; });
  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'spotify-focused:update', operation: { kind: 'enabled', enabled } });
      if (!result?.ok) throw new Error('Save failed');
      render(C.settings(result.state));
      status.textContent = '';
    } catch {
      toggle.checked = !enabled;
      status.textContent = 'Could not save. Please try again.';
    } finally { toggle.disabled = false; }
  });
})();
