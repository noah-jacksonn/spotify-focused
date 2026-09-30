import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

// An original three-bar mark. Generate PNGs without a graphics dependency.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
mkdirSync('extension/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + .5) / size, ny = (y + .5) / size;
    const cornerX = Math.max(.2 - nx, 0, nx - .8), cornerY = Math.max(.2 - ny, 0, ny - .8);
    const inside = Math.hypot(cornerX, cornerY) <= .2;
    const bar = [[.3, .32], [.5, .5], [.7, .32]].some(([center, height]) => {
      const dy = Math.max(Math.abs(ny - .5) - height / 2 + .045, 0);
      return Math.hypot(nx - center, dy) <= .045;
    });
    const pixel = y * (size * 4 + 1) + 1 + x * 4;
    raw.set([...(bar ? [194, 239, 206] : [23, 32, 26]), inside ? 255 : 0], pixel);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  writeFileSync(`extension/icons/icon-${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('Generated extension icons.');
