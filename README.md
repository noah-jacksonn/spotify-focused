# Spotify Focused

A Chrome extension for the Spotify web player: a quiet Home with playlists you choose, a compact favorites sidebar, and Spotify's actual search, songs, artwork, and player.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this project's **extension** folder.
4. Reload your Spotify tab, then click **Spotify Focused** at the top to open Home.

No build, Spotify developer account, API key, or extra sign-in is needed. When changing the extension later, click its reload button on `chrome://extensions`, then reload Spotify. [Chrome's installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Use

- **Home** shows only the playlists you've chosen. On first use, “End of 2026” is selected if Spotify has it loaded in your library. Otherwise choose a playlist yourself.
- **All playlists** opens the real Spotify library in a drawer. It defaults to **Playlists → By you** each time it opens; click **Playlists** to return to all saved playlists. It keeps Spotify's folders, scrolling, search, and sort menu. Use the **+** beside a playlist to show it on Home; **✓** removes it from Home. The title covers all saved playlists, including playlists by other people.
- Open any playlist and use **Show on Home** beside its native controls. Your selection is local to this Chrome profile; it does not change Spotify's library, favorites, playlist contents, or public profile.
- Home's **···** menu also lets you remove a playlist from Home.
- Search works normally once you type. The empty search screen and dropdown hide recent searches and browse recommendations. Search history is hidden, not deleted from Spotify.
- **/** focuses search; **Escape** closes the library or an open Home menu.
- The toolbar popup's **Focused mode** switch restores regular Spotify immediately. Turning it back on keeps your selections.

Playlist artwork, native song actions, sorting, editing, playback, queue, volume, shuffle, and repeat remain Spotify controls. Install/download prompts, the recommendation Home feed, social activity buttons, and the automatic Now Playing recommendations panel are hidden. Playlist recommendations and Find more remain available for discovering music. Podcasts remain reachable through an intentional search.

## Implementation

Manifest V3, plain JavaScript and CSS, no runtime libraries or remote code. Content scripts run only on `https://open.spotify.com/*`. The only extension permission is `storage`.

Cleanup starts at document start so app-install prompts are hidden during refresh, including late popovers and download menu items. The native app shell stays concealed while the Focused layout mounts, with a four-second fallback that reveals Spotify if its layout never becomes available. The right sidebar only opens for the selected Queue or Connect panel, so loading and app-download panels cannot claim that space. Turning Focused mode off restores the normal interface.

The extension layers its own Home and navigation around Spotify's existing UI. It never moves or replaces the native player or song rows. Playlist metadata comes from rendered library rows and the currently open playlist; only the selected Home playlists and settings are saved in `chrome.storage.local`. A small service worker serializes changes from tabs and the popup, and the UI preserves pending choices across asynchronous storage updates. It makes no API requests, reads no authentication tokens, and has no analytics. Artwork is loaded from Spotify's image hosts.

The library deliberately stays native because it is virtualized and can contain folders: copying its currently rendered rows would show an incomplete collection. Opening a playlist uses browser history navigation so the player can stay mounted. Direct playlist links still open the requested playlist; Home replaces Spotify's `/` and `/home` screens.

## Development and checks

```sh
npm install
npm run check
npm test
npm run package
```

`npm run package` produces `dist/spotify-focused.zip`; load the `extension` directory for local development. `npm run icons` regenerates the original three-bar PNG mark.

Tests use Node's test runner and JSDOM, with fixtures based on the inspected Spotify DOM. They cover selection persistence, default removal, recycled library rows, search states, history navigation without replacing the player, stale and duplicate playlist headers, safe text/image handling, storage failures, concurrent saves, and navigation after disabling the extension.

## Browser validation

Installed and exercised in Chrome against the real Spotify web player on September 30, 2026. Verified Home, playlist navigation, adding/removing Home selections, empty search without recent searches, real search results, and the Focused mode off/on switch. Playback advanced while muted and continued across navigation; playback was paused and the prior volume restored afterward. Live checks caught and fixed Spotify's collapsed search field, filtered-library owner labels, and queue panel clipping.

Local tests complement these checks; they do not guarantee compatibility with future Spotify versions. Audible output and every native Spotify action were not exhaustively tested.

Spotify can change its DOM. Stable test IDs and semantic attributes are preferred over generated class names; missing core layout anchors leave normal Spotify visible. Several labels currently assume Spotify's English UI. If a future change breaks the presentation, switch Focused mode off. Home preferences are per Chrome profile, so a different Spotify account in the same profile shares those local selections.
