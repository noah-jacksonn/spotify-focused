# Spotify Unslopified

A Chrome extension for the Spotify web player: a quiet Home with playlists you choose, a compact favorites sidebar, and Spotify's actual search, songs, artwork, and player.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this project's **extension** folder.
4. Reload your Spotify tab, then click **Spotify Unslopified** at the top to open Home.

No build, Spotify developer account, API key, or extra sign-in is needed. When changing the extension later, click its reload button on `chrome://extensions`, then reload Spotify. [Chrome's installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Use

- **Home** shows only the playlists you've chosen. On first use, “End of 2026” is selected if Spotify has it loaded in your library. Otherwise choose a playlist yourself.
- **All playlists** opens the real Spotify library in a drawer. It defaults to **Playlists → By you** each time it opens; click **Playlists** to return to all saved playlists. It keeps Spotify's folders, scrolling, search, and sort menu. Use the **+** beside a playlist to show it on Home; **✓** removes it from Home. The title covers all saved playlists, including playlists by other people.
- Open any playlist and use **Show on Home** beside its native controls. Your selection is local to this Chrome profile; it does not change Spotify's library, favorites, playlist contents, or public profile.
- Home's **···** menu also lets you remove a playlist from Home.
- Search works normally once you type. The empty search screen and dropdown hide recent searches and browse recommendations. Search history is hidden, not deleted from Spotify.
- **/** focuses search; **Escape** closes the library or an open Home menu.
- The toolbar popup's **Unslopified mode** switch restores regular Spotify immediately. Turning it back on keeps your selections.

Playlist artwork, native song actions, sorting, editing, playback, queue, volume, shuffle, and repeat remain Spotify controls. Install/download prompts, the recommendation Home feed, social activity buttons, and the automatic Now Playing recommendations panel are hidden. Playlist recommendations and Find more remain available for discovering music. Podcasts remain reachable through an intentional search.

## Appearance

The Home design is locked to Noah's October 1, 2026 segtest picks: Ink palette; transparent pill search with a quiet ½px outline; a quiet, straight ½px rule below navigation; and a full-width, quiet ½px Ripple above All playlists. Home artwork is 88px with soft 18px corners, with the original 12px spacing. The temporary tester has been removed.

## Implementation

Manifest V3, plain JavaScript and CSS, no runtime libraries or remote code. Content scripts run only on `https://open.spotify.com/*`. Imported audio uses extension storage, an offscreen player, and access to the Spotify web player for playback handoff. Suno access is limited to fetching lyrics in an existing signed-in tab; its login token never leaves that page except in requests to Suno itself.

Cleanup starts at document start so app-install prompts are hidden during refresh, including late popovers and download menu items. The native app shell stays concealed while the Unslopified layout mounts, with a four-second fallback that reveals Spotify if its layout never becomes available. The right sidebar only opens for the selected Queue or Connect panel, so loading and app-download panels cannot claim that space. Turning Unslopified mode off restores the normal interface.

The extension layers its own Home and navigation around Spotify's existing UI. It never moves or replaces the native player or song rows. Playlist metadata comes from rendered library rows and the currently open playlist; Home selections, settings and imported playlist summaries are saved in `chrome.storage.local`. A small service worker serializes changes from tabs and the popup, and the UI preserves pending choices across asynchronous storage updates. It makes no Spotify API requests, reads no Spotify authentication tokens, and has no analytics. Suno lyric requests use the signed-in Suno page as described above. Artwork is loaded from Spotify's image hosts.

The library deliberately stays native because it is virtualized and can contain folders: copying its currently rendered rows would show an incomplete collection. Opening a playlist uses browser history navigation so the player can stay mounted. Direct playlist links still open the requested playlist; Home replaces Spotify's `/` and `/home` screens.

## Shared music folder

Open **Imported playlists** in the popup or **Imported** in Spotify’s All playlists drawer. Choose **Connect music folder** and grant access to a dedicated folder in iCloud Drive. Select the same parent folder in the [iPhone app](https://github.com/noah-jacksonn/spotify-unslopified-ios), using the same iCloud account on both devices. Each direct subfolder is a playlist. You can import audio from either app or add files in Finder.

Opening an imported playlist from Spotify stays in the same tab so browser Back returns to Spotify. Home and the playlist share the same cover or fallback gradient. Starting a Spotify track restores the native player and pauses imported audio; Space controls whichever player is active. The imported queue is a right-side panel with current/upcoming artwork, skip, remove, and drag reordering (also available as Move up/down in each song menu). It stays open alongside lyrics. The imported audio player uses a shared Spotify-style bar with artwork, seeking, shuffle, repeat, mute, volume and queue controls. Lyrics fill the page above the bar with clickable timed lines; they follow playback until you scroll, and the Follow lyrics control toggles tracking. **Keep offline** caches a playlist in the Chrome profile. The extension reads the folder on open, refresh and while the library is visible. iCloud handles transfer timing. A background check once per minute also fills missing Suno lyrics, including songs added from iPhone or Finder. Keep a signed-in Suno tab open and grant read/write access to the music folder. Imports remain playable if lyrics are unavailable; a brief toast explains a missing tab or login. Song details offers Retry lyrics. Existing lyrics are never overwritten.

For example, download songs you made with **Suno AI**, create a **Suno** playlist and import them. Save each song’s Suno source link in Song details to fetch its missing timed lyrics automatically while a signed-in Suno tab is open. Covers, song details and lyrics live beside the audio and reach the iPhone app through iCloud. These imported playlists are separate from Spotify’s catalog playlists. Playback format support varies between iPhone and Chrome.

Refresh uses existing folder access without prompting. If Chrome expires that access, choose **Reconnect folder** to grant it again. Disconnect forgets the selected folder and its cached audio in this Chrome profile; it leaves the iCloud files untouched.

### Folder format

Playlist cover editing preserves the selected photo bytes, an oriented full-frame JPEG preview, and viewport-relative `zoom`, `x`, and `y` in `cover.json`. Both editors reopen that crop. Immutable `cover-original-*`, `cover-source-*`, and `cover-rendered-*` files are written before the recipe so iCloud can deliver them in any order; readers use the recipe's render when it is available. `cover.jpg` remains a compatibility copy. Older square covers can be adjusted, but their previously discarded pixels cannot be recovered. Display images stay 640px; large originals are used only by the editor.

A playlist named `Suno` lives in `Suno/`. Its optional square cover is `cover.jpg`. Ordinary audio files work without metadata. A file such as `Song.mp3.json` next to `Song.mp3` can hold title, artist, durationMs, ISO creation/import dates (`createdAt`, `importedAt`), lyrics, sourceURL, a sibling artworkFile and numeric order. To carry metadata through Import songs, select the audio and its matching `<audio filename>.json` together. Suno lyrics require a valid `https://suno.com/song/<id>` source link; bare audio files do not reliably identify their originating Suno song. Archiving creates `Unslopified.archive.json` inside the playlist. Removing that marker restores the playlist.

## Development and checks

```sh
npm install
npm run check
npm test
npm run package
```

`npm run package` produces `dist/spotify-unslopified.zip`; load the `extension` directory for local development. `npm run icons` regenerates the original three-bar PNG mark.

Tests use Node's test runner and JSDOM, with fixtures based on the inspected Spotify DOM. They cover selection persistence, default removal, recycled library rows, search states, history navigation without replacing the player, stale and duplicate playlist headers, safe text/image handling, storage failures, concurrent saves, and navigation after disabling the extension.

## Browser validation

Installed and exercised in Chrome against the real Spotify web player on September 30, 2026. Verified Home, playlist navigation, adding/removing Home selections, empty search without recent searches, real search results, and the Unslopified mode off/on switch. Playback advanced while muted and continued across navigation; playback was paused and the prior volume restored afterward. Live checks caught and fixed Spotify's collapsed search field, filtered-library owner labels, and queue panel clipping.

Local tests complement these checks; they do not guarantee compatibility with future Spotify versions. Audible output and every native Spotify action were not exhaustively tested.

Spotify can change its DOM. Stable test IDs and semantic attributes are preferred over generated class names; missing core layout anchors leave normal Spotify visible. Several labels currently assume Spotify's English UI. If a future change breaks the presentation, switch Unslopified mode off. Home preferences are per Chrome profile, so a different Spotify account in the same profile shares those local selections.
