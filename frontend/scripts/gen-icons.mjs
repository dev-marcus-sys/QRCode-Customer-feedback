// 純 Node（zlib）產生 PWA 圖示：漸層藍底 + 白色對話氣泡 + 三個藍點（訊息/意見反饋意象）。
// 不依賴 sharp 等原生套件，避開 assets-generator 在 Windows 上的 colorette / sharp 解析問題。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve('public/pwa-assets');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  const table =
    crc32.table ||
    (crc32.table = (() => {
      const t = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;

function inRoundRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 + r && py < y0 + r) {
    if ((px - (x0 + r)) ** 2 + (py - (y0 + r)) ** 2 > r * r) return false;
  } else if (px > x1 - r && py < y0 + r) {
    if ((px - (x1 - r)) ** 2 + (py - (y0 + r)) ** 2 > r * r) return false;
  } else if (px < x0 + r && py > y1 - r) {
    if ((px - (x0 + r)) ** 2 + (py - (y1 - r)) ** 2 > r * r) return false;
  } else if (px > x1 - r && py > y1 - r) {
    if ((px - (x1 - r)) ** 2 + (py - (y1 - r)) ** 2 > r * r) return false;
  }
  return px >= x0 && px <= x1 && py >= y0 && py <= y1;
}

function render(N) {
  const buf = Buffer.alloc(N * N * 4);
  const top = [0x19, 0x76, 0xd2];
  const bot = [0x15, 0x65, 0xc0];
  const white = [255, 255, 255];
  const dot = [0x15, 0x65, 0xc0];
  const bw = N * 0.62;
  const bh = N * 0.5;
  const bx0 = (N - bw) / 2;
  const by0 = (N - bh) / 2 - N * 0.03;
  const bx1 = bx0 + bw;
  const by1 = by0 + bh;
  const br = N * 0.12;
  const dotR = N * 0.05;
  const dy = by0 + bh * 0.5;
  const dxs = [bx0 + bw * 0.32, bx0 + bw * 0.5, bx0 + bw * 0.68];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const t = y / N;
      let r = lerp(top[0], bot[0], t);
      let g = lerp(top[1], bot[1], t);
      let b = lerp(top[2], bot[2], t);
      if (inRoundRect(x, y, bx0, by0, bx1, by1, br)) {
        r = white[0];
        g = white[1];
        b = white[2];
      }
      for (const dx of dxs) {
        if ((x - dx) ** 2 + (y - dy) ** 2 <= dotR * dotR) {
          r = dot[0];
          g = dot[1];
          b = dot[2];
        }
      }
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return Buffer.from(buf);
}

const targets = [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['maskable-192x192.png', 192],
  ['maskable-512x512.png', 512],
  ['apple-touch-icon-180x180.png', 180],
];
for (const [name, size] of targets) {
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, size, render(size)));
  console.log('wrote', name);
}
