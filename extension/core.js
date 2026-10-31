/* Shared data helpers. No Spotify APIs, cookies, or authentication access. */
((scope) => {
  'use strict';
  const STORAGE_KEY = 'spotifyFocused.v1';
  const ID = /^[a-zA-Z0-9]{22}$/;

  function playlistId(value) {
    if (typeof value !== 'string') return null;
    if (ID.test(value)) return value;
    const uri = value.match(/(?:^|listrow-title-)spotify:playlist:([a-zA-Z0-9]{22})$/);
    if (uri) return uri[1];
    try {
      const url = new URL(value, 'https://open.spotify.com');
      if (url.origin !== 'https://open.spotify.com') return null;
      return url.pathname.match(/^\/(?:intl-[a-z-]+\/)?playlist\/([a-zA-Z0-9]{22})\/?$/)?.[1] || null;
    } catch { return null; }
  }

  function imageUrl(value) {
    try {
      const url = new URL(value);
      const allowed = ['scdn.co', 'spotifycdn.com'];
      return url.protocol === 'https:' && allowed.some(host => url.hostname === host || url.hostname.endsWith('.' + host)) ? url.href : '';
    } catch { return ''; }
  }

  function cleanPlaylist(value) {
    const id = playlistId(value?.id);
    const name = typeof value?.name === 'string' ? value.name.trim().slice(0, 250) : '';
    if (!id || !name) return null;
    return { id, name, owner: typeof value.owner === 'string' ? value.owner.trim().slice(0, 150) : '', image: imageUrl(value.image) };
  }

  function settings(value) {
    const unique = new Map();
    for (const item of Array.isArray(value?.home) ? value.home : []) {
      const playlist = cleanPlaylist(item);
      if (playlist && !unique.has(playlist.id)) unique.set(playlist.id, playlist);
      if (unique.size >= 200) break;
    }
    return { enabled: value?.enabled !== false, home: [...unique.values()], didChooseHome: value?.didChooseHome === true || unique.size > 0,
      revision: Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0 };
  }

  // Idempotent operations can be replayed over saved state while a write is pending.
  function applyOperation(value, operation) {
    const next = settings(value);
    if (operation?.kind === 'enabled' && typeof operation.enabled === 'boolean') next.enabled = operation.enabled;
    if (operation?.kind === 'home') {
      const playlist = cleanPlaylist(operation.playlist);
      if (!playlist) return next;
      const index = next.home.findIndex(p => p.id === playlist.id);
      if (operation.selected === false) next.home = next.home.filter(p => p.id !== playlist.id);
      else if (index >= 0) next.home[index] = playlist;
      else if (next.home.length < 200) next.home.push(playlist);
      next.didChooseHome = true;
    }
    if (operation?.kind === 'metadata' && Array.isArray(operation.playlists)) {
      for (const value of operation.playlists.slice(0, 200)) {
        const playlist = cleanPlaylist(value);
        const existing = playlist && next.home.find(p => p.id === playlist.id);
        if (existing) Object.assign(existing, { ...playlist, owner: playlist.owner || existing.owner,
          image: value.source === 'library' ? existing.image || playlist.image : playlist.image || existing.image });
      }
    }
    return next;
  }

  function readLibraryRow(row) {
    const title = row.querySelector('[id^="listrow-title-spotify:playlist:"]');
    if (!title) return null;
    const subtitle = row.querySelector('[data-encore-id="listRowSubtitle"]')?.textContent || '';
    return cleanPlaylist({
      id: playlistId(title.id), name: title.textContent,
      owner: (subtitle.includes('•') ? subtitle.split('•').slice(1).join('•') : subtitle.replace(/^Pinned\s*/, '')).trim(),
      image: row.querySelector('img')?.getAttribute('src')
    });
  }

  function route(pathname) {
    const path = pathname.replace(/^\/intl-[a-z-]+(?=\/)/, '').replace(/\/$/, '') || '/';
    if (path === '/' || path === '/home') return 'home';
    if (path === '/search') return 'search-empty';
    if (playlistId(path)) return 'playlist';
    return 'content';
  }

  const api = { STORAGE_KEY, playlistId, imageUrl, cleanPlaylist, settings, applyOperation, readLibraryRow, route };
  scope.SpotifyFocusedCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
