(() => {
  'use strict';
  if (globalThis.__spotifyFocused) return;
  const C = globalThis.SpotifyFocusedCore;
  const html = document.documentElement;
  // Apply narrow cleanup before Spotify paints; reveal its shell once mounted.
  html.setAttribute('data-sf-clean', '');
  html.setAttribute('data-sf-loading', '');
  const bootTimer = setTimeout(finishLoading, 4000);
  const own = '[data-sf-ui]';
  let state = C.settings();
  let persisted = C.settings();
  const pending = [];
  const pendingMetadata = new Map();
  const observedMetadata = new Map();
  let didSeedAttempt = false;
  let metadataWritesFailed = false;
  let ready = false;
  let disposed = false;
  let drawerOpen = false;
  let drawerReturnFocus = null;
  let scheduled = null;
  let saveTimer = null;
  let lastURL = location.href;
  let renderKey = '';
  let layout = null;
  let library = null;
  let mainShell = null;
  let lastPlaylistRead = null;
  let sidebar = null;
  let home = null;
  let brand = null;
  let libraryClose = null;
  let pinControl = null;
  let backdrop = null;
  let status = null;
  let filterDefaultPending = false;
  let applyingFilter = false;
  const filterAttempts = new Set();

  function finishLoading() {
    clearTimeout(bootTimer);
    html.removeAttribute('data-sf-loading');
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function ui(tag, className) {
    const node = el(tag, className);
    node.setAttribute('data-sf-ui', '');
    return node;
  }

  function button(text, className, action) {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function announce(message) {
    if (!status?.isConnected) {
      status = ui('div', 'sf-status');
      status.setAttribute('role', 'status');
      (document.body || html).append(status);
    }
    status.textContent = message;
    status.classList.toggle('sf-error', Boolean(message));
  }

  function deriveState() {
    state = pending.reduce((value, entry) => C.applyOperation(value, entry.operation), C.settings(persisted));
  }

  function adopt(value) {
    const incoming = C.settings(value);
    if (incoming.revision >= persisted.revision) persisted = incoming;
    deriveState();
  }

  function persist(operation) {
    const entry = { operation };
    pending.push(entry);
    deriveState();
    chrome.runtime.sendMessage({ type: 'spotify-focused:update', operation }).then(result => {
      if (!result?.ok) throw new Error('Save failed');
      pending.splice(pending.indexOf(entry), 1);
      adopt(result.state);
      if (!disposed) { if (state.enabled) reconcile(); else disable(); }
    }).catch(() => {
      if (operation.kind === 'metadata') metadataWritesFailed = true;
      const index = pending.indexOf(entry);
      if (index >= 0) pending.splice(index, 1);
      deriveState();
      if (!disposed) {
        if (state.enabled) reconcile(); else disable();
        announce('Your Home could not be saved. Reload Spotify and try again.');
      }
    });
  }

  function toggleHome(playlist) {
    if (!playlist) return;
    const exists = state.home.some(p => p.id === playlist.id);
    announce('');
    renderKey = '';
    persist({ kind: 'home', playlist, selected: !exists });
    reconcile();
  }

  function updateMetadata(playlist, source = 'library') {
    const existing = state.home.find(p => p.id === playlist.id);
    if (!existing) return;
    // Storage events are not new Spotify metadata. Submit each observed change
    // once, and let a playlist's full artwork supersede library thumbnails.
    const key = source + ':' + playlist.id;
    const signature = JSON.stringify(playlist);
    if (observedMetadata.get(key) === signature) return;
    observedMetadata.set(key, signature);
    const next = { ...playlist, owner: playlist.owner || existing.owner,
      image: source === 'library' ? existing.image || playlist.image : playlist.image || existing.image };
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      Object.assign(existing, next);
      if (metadataWritesFailed) return;
      pendingMetadata.set(playlist.id, { ...next, source });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const playlists = [...pendingMetadata.values()];
        pendingMetadata.clear();
        persist({ kind: 'metadata', playlists });
      }, 400);
    }
  }

  function navigate(path) {
    setDrawer(false, false);
    if (location.pathname === path) return;
    // BrowserRouter listens to popstate. Keep its history index for Back/Forward
    // and leave the player mounted instead of forcing a document navigation.
    const previous = history.state || {};
    const next = { usr: null, key: crypto.randomUUID().slice(0, 8), idx: (Number.isInteger(previous.idx) ? previous.idx : 0) + 1 };
    history.pushState(next, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: next }));
    schedule();
  }

  function link(text, path, className) {
    const a = el('a', className, text);
    a.href = path;
    a.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(path);
    });
    return a;
  }

  function cover(playlist) {
    const wrap = el('span', 'sf-cover');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.append(el('span', 'sf-cover-fallback', playlist.name.slice(0, 1).toUpperCase()));
    if (playlist.image) {
      const img = el('img');
      img.src = playlist.image;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove(), { once: true });
      wrap.append(img);
    }
    return wrap;
  }

  function homeRow(playlist) {
    const row = el('li', 'sf-home-row');
    const a = link('', '/playlist/' + playlist.id, 'sf-playlist-link');
    const text = el('span', 'sf-playlist-copy');
    text.append(el('strong', '', playlist.name));
    if (playlist.owner) text.append(el('span', 'sf-secondary', playlist.owner));
    a.append(cover(playlist), text);
    const menu = el('details', 'sf-menu');
    const summary = el('summary', 'sf-menu-trigger', '···');
    summary.setAttribute('aria-label', 'Options for ' + playlist.name);
    const panel = el('div', 'sf-menu-panel');
    const label = el('label', 'sf-check-label');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = true;
    check.addEventListener('change', () => {
      toggleHome(playlist);
      home?.querySelector('.sf-all')?.focus();
    });
    label.append(check, document.createTextNode('Show on Home'));
    panel.append(label);
    menu.append(summary, panel);
    row.append(a, menu);
    return row;
  }

  function render() {
    if (!home || !sidebar) return;
    const page = C.route(location.pathname);
    const key = JSON.stringify([state.home, page, C.playlistId(location.pathname), drawerOpen]);
    if (renderKey === key) return;
    renderKey = key;
    home.replaceChildren();
    sidebar.replaceChildren();
    sidebar.append(link('Home', '/home', 'sf-nav-home'));
    for (const playlist of state.home) {
      const a = link('', '/playlist/' + playlist.id, 'sf-nav-playlist');
      a.append(cover(playlist), el('span', '', playlist.name));
      if (C.playlistId(location.pathname) === playlist.id) a.setAttribute('aria-current', 'page');
      sidebar.append(a);
    }
    sidebar.append(button('All playlists', 'sf-nav-all', () => setDrawer(!drawerOpen)));
    if (page === 'search-empty') {
      home.append(el('h1', '', 'Search music'), el('p', 'sf-empty', 'Find a song, artist, album, or podcast using the search above.'));
      return;
    }
    home.append(el('h1', '', 'Home'));
    if (state.home.length) {
      const list = el('ul', 'sf-home-list');
      list.append(...state.home.map(homeRow));
      home.append(list);
    } else {
      home.append(el('p', 'sf-empty', 'Your music, a little closer. Open All playlists and choose Show on Home.'));
    }
    const all = button('All playlists', 'sf-all', () => setDrawer(!drawerOpen));
    all.setAttribute('aria-label', 'All playlists');
    all.setAttribute('aria-expanded', String(drawerOpen));
    all.setAttribute('aria-controls', library?.id || 'sf-library');
    home.append(all);
  }

  function gridChild(node, parent) {
    if (!node || !parent?.contains(node)) return null;
    while (node.parentElement && node.parentElement !== parent) node = node.parentElement;
    return node.parentElement === parent ? node : null;
  }

  function setDrawer(open, restoreFocus = true) {
    if (!state.enabled || !html.hasAttribute('data-sf-enabled')) return;
    if (open && !library) {
      announce('Spotify’s library is still loading. Try again in a moment.');
      return;
    }
    if (open && !drawerOpen) drawerReturnFocus = document.activeElement;
    drawerOpen = open;
    html.toggleAttribute('data-sf-library-open', open);
    if (library) {
      library.inert = !open;
      if (open) {
        library.setAttribute('role', 'dialog');
        library.setAttribute('aria-modal', 'true');
        library.setAttribute('aria-label', 'All playlists');
      } else {
        library.removeAttribute('role');
        library.removeAttribute('aria-modal');
        library.removeAttribute('aria-label');
      }
    }
    if (mainShell) mainShell.inert = open;
    if (sidebar) sidebar.inert = open;
    render();
    if (open) {
      filterDefaultPending = true;
      filterAttempts.clear();
      filterPlaylists();
      libraryClose?.focus();
    } else if (restoreFocus) {
      if (drawerReturnFocus?.isConnected) drawerReturnFocus.focus();
      else home?.querySelector('.sf-all')?.focus();
    }
  }

  function filterPlaylists() {
    if (!drawerOpen || !library || !filterDefaultPending) return;
    // By you arrives asynchronously after Spotify applies the Playlists filter.
    for (const label of ['Playlists', 'By you']) {
      const chip = library.querySelector(`[data-encore-id="chip"][aria-label="${label}"]`);
      if (!chip) return;
      const option = chip.closest('[role="option"]');
      if (chip.getAttribute('aria-checked') === 'true' || option?.getAttribute('aria-selected') === 'true') continue;
      if (filterAttempts.has(label)) return;
      filterAttempts.add(label);
      applyingFilter = true;
      try { (option || chip).click(); } finally { applyingFilter = false; }
      if (label === 'By you') filterDefaultPending = false;
      return;
    }
    filterDefaultPending = false;
  }

  function onFilterClick(event) {
    if (!applyingFilter && drawerOpen && library?.contains(event.target) && event.target.closest('[role="option"]')) {
      filterDefaultPending = false;
      const playlists = event.target.closest('[role="option"]').querySelector('[aria-label="Playlists"]');
      const byYou = library.querySelector('[data-encore-id="chip"][aria-label="By you"][aria-checked="true"]');
      // Spotify normally clears both levels here. Keep Playlists selected when
      // going from your playlists back to everyone's saved playlists.
      if (playlists && byYou) {
        event.preventDefault();
        event.stopPropagation();
        applyingFilter = true;
        try { (byYou.closest('[role="option"]') || byYou).click(); } finally { applyingFilter = false; }
      }
    }
  }

  function mount() {
    const globalNav = document.querySelector('[data-testid="global-nav-bar"]');
    const libraryContent = document.querySelector('.YourLibraryX');
    const mainView = document.querySelector('.main-view-container');
    // Stay with regular Spotify if its structure changes or the user is logged out.
    if (!globalNav || !libraryContent || !mainView) return false;
    layout = globalNav.parentElement;
    library = gridChild(libraryContent, layout);
    mainShell = gridChild(mainView, layout);
    if (!library || !mainShell) return false;
    layout.setAttribute('data-sf-layout', '');
    library.setAttribute('data-sf-library', '');
    library.id ||= 'sf-library';
    library.inert = !drawerOpen;
    mainShell.setAttribute('data-sf-main', '');
    const player = gridChild(document.querySelector('[data-testid="now-playing-bar"]'), layout);
    if (player) player.setAttribute('data-sf-player', '');
    for (const child of layout.children) {
      if (child.hasAttribute('data-sf-ui')) continue;
      const area = getComputedStyle(child).gridArea;
      if (area.startsWith('right-sidebar')) child.setAttribute('data-sf-right', '');
      if (area === 'top-banner') child.setAttribute('data-sf-promo', '');
    }
    for (const child of globalNav.children) {
      if (child.hasAttribute('data-sf-ui')) continue;
      if (child.querySelector('[data-testid="search-input"]')) child.setAttribute('data-sf-search-wrap', '');
      if (child.querySelector('[data-testid="user-widget-link"]')) child.setAttribute('data-sf-account-wrap', '');
    }
    if (!brand?.isConnected) {
      brand = ui('div', 'sf-brand');
      const a = link('', '/home', 'sf-brand-link');
      const mark = el('span', 'sf-mark');
      mark.setAttribute('aria-hidden', 'true');
      mark.append(el('i'), el('i'), el('i'));
      a.append(mark, el('span', '', 'Spotify '), el('span', 'sf-brand-light', 'Focused'));
      brand.append(a);
      globalNav.prepend(brand);
    }
    if (!sidebar?.isConnected) {
      sidebar = ui('nav', 'sf-sidebar');
      sidebar.setAttribute('aria-label', 'Focused navigation');
      layout.append(sidebar);
      renderKey = '';
    }
    if (!home?.isConnected || home.parentElement !== mainShell) {
      home?.remove();
      home = ui('section', 'sf-home');
      home.setAttribute('aria-label', 'Your music');
      mainShell.append(home);
      renderKey = '';
    }
    if (!libraryClose?.isConnected) {
      libraryClose = ui('div', 'sf-library-heading');
      const close = button('Close', 'sf-close', () => setDrawer(false));
      close.setAttribute('aria-label', 'Close all playlists');
      libraryClose.append(el('h2', '', 'All playlists'), close);
      library.prepend(libraryClose);
      libraryClose = close;
    }
    if (!backdrop?.isConnected) {
      backdrop = ui('button', 'sf-backdrop');
      backdrop.type = 'button';
      backdrop.tabIndex = -1;
      backdrop.setAttribute('aria-label', 'Close all playlists');
      backdrop.addEventListener('click', () => setDrawer(false));
      layout.append(backdrop);
    }
    return true;
  }

  function collectLibrary() {
    if (!library) return;
    for (const row of library.querySelectorAll('[role="row"]')) {
      const playlist = C.readLibraryRow(row);
      let pin = row.querySelector('.sf-library-pin');
      // Virtualized rows may be recycled for an album, folder, or another playlist.
      if (!playlist) { pin?.remove(); row.removeAttribute('data-sf-playlist-row'); continue; }
      // The open page has the authoritative title and higher-resolution artwork.
      if (playlist.id !== C.playlistId(location.pathname)) updateMetadata(playlist);
      if (!state.didChooseHome && !didSeedAttempt && /^end of 2026$/i.test(playlist.name)) {
        didSeedAttempt = true;
        persist({ kind: 'seed', playlist, selected: true });
      }
      row.setAttribute('data-sf-playlist-row', '');
      if (!pin) {
        pin = ui('button', 'sf-library-pin');
        pin.type = 'button';
        // Capture before Spotify's row handler so pinning never starts playback.
        pin.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          toggleHome(C.readLibraryRow(pin.closest('[role="row"]')));
        });
        row.querySelector('[role="gridcell"]')?.append(pin);
      }
      const selected = state.home.some(p => p.id === playlist.id);
      const label = (selected ? 'Remove from Home: ' : 'Show on Home: ') + playlist.name;
      if (pin.getAttribute('aria-label') !== label) {
        pin.setAttribute('aria-label', label);
        pin.setAttribute('data-sf-tooltip', 'Show on Home');
        pin.setAttribute('aria-pressed', String(selected));
        pin.textContent = selected ? '✓' : '+';
      }
    }
  }

  function readCurrentPlaylist() {
    const id = C.playlistId(location.pathname);
    const page = document.querySelector('[data-testid="playlist-page"]');
    const title = page?.querySelector('[data-testid="entityTitle"] h1, [data-testid="entityTitle"]');
    if (!id || !title?.textContent?.trim()) return null;
    // During navigation Spotify can retain the previous page while loading.
    const pageURI = page.getAttribute('data-uri');
    if (pageURI && C.playlistId(pageURI) !== id) return null;
    const signature = title.textContent + '|' + (page.querySelector('[data-testid="playlist-image"] img')?.getAttribute('src') || '');
    if (!pageURI && lastPlaylistRead && lastPlaylistRead.id !== id && lastPlaylistRead.page === page && lastPlaylistRead.title === title && lastPlaylistRead.signature === signature) return null;
    lastPlaylistRead = { id, signature, page, title };
    return C.cleanPlaylist({ id, name: title.textContent,
      owner: page.querySelector('[data-testid="creator-link"]')?.textContent,
      image: page.querySelector('[data-testid="playlist-image"] img')?.getAttribute('src') });
  }

  function updatePlaylistControl() {
    const currentPlaylist = readCurrentPlaylist();
    const actions = document.querySelector('[data-testid="playlist-page"] [data-testid="action-bar-row"]');
    if (!currentPlaylist || !actions) { pinControl?.remove(); pinControl = null; return; }
    updateMetadata(currentPlaylist, 'playlist');
    if (!pinControl?.isConnected || pinControl.parentElement !== actions) {
      pinControl?.remove();
      pinControl = ui('label', 'sf-show-home');
      pinControl.title = 'Show on Home';
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => toggleHome(readCurrentPlaylist()));
      pinControl.append(checkbox, document.createTextNode('Show on Home'));
      actions.append(pinControl);
    }
    pinControl.querySelector('input').checked = state.home.some(p => p.id === currentPlaylist.id);
  }

  function updateSearch() {
    const input = document.querySelector('[data-testid="search-input"]');
    const empty = !input?.value?.trim();
    html.toggleAttribute('data-sf-search-empty', empty);
    for (const target of document.querySelectorAll('[data-sf-search-popup]')) target.removeAttribute('data-sf-search-popup');
    for (const id of (input?.getAttribute('aria-controls') || '').split(/\s+/)) {
      const target = id && document.getElementById(id);
      if (target) target.setAttribute('data-sf-search-popup', '');
    }
    // Some Spotify versions render search history outside the controlled listbox.
    for (const heading of document.querySelectorAll('h2, h3')) {
      if (heading.closest(own) || heading.textContent.trim() !== 'Recent searches') continue;
      const section = heading.closest('section');
      if (section && !section.matches('[data-testid="playlist-page"]')) section.setAttribute('data-sf-history', '');
    }
  }

  function hideRecommendations() {
    for (const heading of document.querySelectorAll('main h2, main h3')) {
      if (!/^(Recommended|Recommended songs|Fans also like|More like .+)$/i.test(heading.textContent.trim())) continue;
      const section = heading.closest('section');
      if (section && !section.matches('[data-testid$="-page"]')) {
        section.toggleAttribute('data-sf-recommendation', C.route(location.pathname) !== 'playlist');
      }
    }
  }

  function hideAppPromotions() {
    const appPitch = /\b(?:download|install|open|listen|play offline)\b.{0,100}\b(?:(?:Mac|Windows|desktop|Spotify) app|free app|app for (?:Mac|Windows))\b|\bdownload (?:Spotify )?for (?:Mac|Windows)\b/i;
    const appControl = /^(?:Download|Install (?:App|Spotify)|Download (?:Spotify|(?:the )?(?:free |desktop |Mac |Windows )?app)|Download (?:Spotify )?for (?:Mac|Windows)(?:OS)?|Open (?:in )?(?:the )?(?:desktop|Mac|Windows) app)$/i;
    for (const node of document.querySelectorAll('[role="dialog"], [role="tooltip"], [data-tippy-root], [role="menuitem"], button')) {
      // The library is our dialog, and its playlist names are user content.
      if (node.closest(own + ', [data-sf-library]')) {
        node.removeAttribute('data-sf-app-promo');
        continue;
      }
      const overlay = node.matches('[role="dialog"], [role="tooltip"], [data-tippy-root]');
      const label = node.getAttribute('aria-label') || '';
      const text = (overlay ? label + ' ' + node.textContent : label || node.textContent || '').replace(/\s+/g, ' ').trim();
      node.toggleAttribute('data-sf-app-promo', overlay ? appPitch.test(text) : appControl.test(text));
    }
  }

  function updateRightSidebar() {
    const right = document.querySelector('[data-sf-right]');
    const queue = right?.querySelector('aside[aria-label="Queue"]') &&
      document.querySelector('[data-testid="control-button-queue"][aria-pressed="true"]');
    const connect = right?.querySelector('aside[aria-label="Connect to a device"]') &&
      document.querySelector('button[aria-label="Connect to a device"][aria-pressed="true"]');
    // Only display panels the user opened. Unknown loading/promotion panels
    // must never count as useful content merely because they contain text.
    html.toggleAttribute('data-sf-right-open', Boolean(queue || connect));
  }

  function reconcile() {
    if (disposed || !ready || !state.enabled) return;
    try {
      html.setAttribute('data-sf-clean', '');
      hideAppPromotions();
      // Spotify builds/replaces its layout in stages. Keep promotion cleanup
      // active even when the full Focused shell cannot mount yet.
      if (!mount()) { disable(true); return; }
      html.setAttribute('data-sf-enabled', '');
      html.setAttribute('data-sf-page', C.route(location.pathname));
      updateRightSidebar();
      collectLibrary();
      updatePlaylistControl();
      updateSearch();
      hideRecommendations();
      filterPlaylists();
      render();
      finishLoading();
    } catch (error) {
      disable();
      console.warn('Spotify Focused restored the normal layout:', error.message);
    }
  }

  function disable(keepCleanup = false) {
    if (!keepCleanup) {
      html.removeAttribute('data-sf-clean');
      finishLoading();
    }
    clearTimeout(saveTimer);
    pendingMetadata.clear();
    html.removeAttribute('data-sf-enabled');
    html.removeAttribute('data-sf-page');
    html.removeAttribute('data-sf-library-open');
    html.removeAttribute('data-sf-right-open');
    html.removeAttribute('data-sf-search-empty');
    if (library) {
      library.inert = false;
      library.removeAttribute('role');
      library.removeAttribute('aria-modal');
      library.removeAttribute('aria-label');
    }
    if (mainShell) mainShell.inert = false;
    drawerOpen = false;
    document.querySelectorAll(own).forEach(node => node.remove());
    document.querySelectorAll('[data-sf-playlist-row]').forEach(node => node.removeAttribute('data-sf-playlist-row'));
    renderKey = '';
  }

  function schedule() {
    if (scheduled || disposed || !ready || !state.enabled) return;
    scheduled = setTimeout(() => { scheduled = null; reconcile(); }, 100);
  }

  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (target?.closest(own)) return false;
      if (target?.closest('[data-testid="now-playing-bar"]') && record.attributeName !== 'aria-pressed') return false;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === Node.ELEMENT_NODE && node.matches(own))) return false;
      return true;
    })) {
      if (ready && state.enabled) { hideAppPromotions(); updateRightSidebar(); }
      schedule();
    }
  });

  function onInput(event) {
    if (event.target.matches('[data-testid="search-input"]')) {
      html.toggleAttribute('data-sf-search-empty', !event.target.value.trim());
      schedule();
    }
  }

  function onKey(event) {
    if (drawerOpen && event.key === 'Tab') {
      const focusable = [...library.querySelectorAll('button, a[href], input, [tabindex="0"]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (first && event.shiftKey && (document.activeElement === first || !library.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (first && !event.shiftKey && (document.activeElement === last || !library.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    if (event.key === 'Escape') {
      if (drawerOpen) { event.preventDefault(); setDrawer(false); }
      document.querySelectorAll('.sf-menu[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
    }
    if (event.key === '/' && state.enabled && !event.metaKey && !event.ctrlKey && !event.altKey &&
      !event.target.matches('input, textarea, select, [contenteditable="true"]')) {
      event.preventDefault();
      document.querySelector('[data-testid="search-input"]')?.focus();
    }
  }

  function onStorage(changes, area) {
    if (area !== 'local' || !changes[C.STORAGE_KEY]) return;
    adopt(changes[C.STORAGE_KEY].newValue);
    if (state.enabled) reconcile(); else disable();
  }

  const routeTimer = setInterval(() => {
    if (lastURL !== location.href) {
      lastURL = location.href;
      setDrawer(false, false);
      schedule();
    }
  }, 350);

  async function start() {
    try {
      const result = await chrome.storage.local.get(C.STORAGE_KEY);
      adopt(result[C.STORAGE_KEY]);
      ready = true;
      observer.observe(html, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['aria-controls', 'aria-checked', 'aria-selected', 'aria-pressed', 'aria-label', 'data-testid', 'role', 'href', 'src', 'id'] });
      document.addEventListener('input', onInput, true);
      document.addEventListener('click', onFilterClick, true);
      document.addEventListener('keydown', onKey);
      chrome.storage.onChanged.addListener(onStorage);
      if (state.enabled) reconcile(); else disable();
    } catch {
      disable();
      announce('Spotify Focused could not load. Reload Spotify to reconnect the extension.');
    }
  }

  globalThis.__spotifyFocused = {
    refresh: reconcile,
    dispose() {
      disposed = true;
      observer.disconnect();
      clearInterval(routeTimer);
      clearTimeout(scheduled);
      clearTimeout(saveTimer);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('click', onFilterClick, true);
      document.removeEventListener('keydown', onKey);
      chrome.storage.onChanged.removeListener(onStorage);
      disable();
    }
  };
  start();
})();
