(() => {
  'use strict';
  const C = globalThis.SpotifyFocusedCore;
  const toggle = document.getElementById('enabled');
  const summary = document.getElementById('summary');
  const status = document.getElementById('status');
  function render(state) {
    toggle.checked = state.enabled;
    summary.textContent = state.home.length ? `${state.home.length} playlist${state.home.length === 1 ? '' : 's'} on Home` : 'Choose your first playlist on Spotify.';
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
