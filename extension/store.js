((scope) => {
  'use strict';
  const C = scope.SpotifyFocusedCore || require('./core.js');
  function createStore(storage) {
    let queue = Promise.resolve();
    return {
      update(operation) {
        const result = queue.then(async () => {
          const saved = await storage.get(C.STORAGE_KEY);
          const current = C.settings(saved[C.STORAGE_KEY]);
          const next = C.applyOperation(current, operation);
          if (JSON.stringify(current) !== JSON.stringify(next)) {
            next.revision = current.revision + 1;
            await storage.set({ [C.STORAGE_KEY]: next });
          }
          return next;
        });
        queue = result.catch(() => {});
        return result;
      }
    };
  }
  scope.SpotifyFocusedStore = { createStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createStore };
})(globalThis);
