/* A single writer prevents tabs and the popup from overwriting one another. */
importScripts('core.js', 'store.js');
const store = SpotifyFocusedStore.createStore(chrome.storage.local);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'spotify-focused:update') return;
  store.update(message.operation).then(
    state => respond({ ok: true, state }),
    () => respond({ ok: false })
  );
  return true;
});
