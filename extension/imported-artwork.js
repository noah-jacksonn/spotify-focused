/* The same playlist artwork and fallback palette on Home and in the library. */
globalThis.ImportedArtwork = {
  source(list) { return list.coverFile || (list.cover ? 'cover.jpg' : list.songs[0]?.artworkFile); },
  async gradient(seed) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
    const hue = new DataView(digest).getUint16(0) * 360 / 65536;
    return `linear-gradient(135deg,hsl(${hue} 42% 78%),hsl(${hue} 52% 43%),hsl(${(hue + 29) % 360} 62% 15%))`;
  }
};
