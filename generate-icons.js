/**
 * アプリアイコン（PNG）を生成するスクリプト
 * node generate-icons.js
 */

const zlib = require('zlib');
const fs   = require('fs');

// ── CRC32 ──────────────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG チャンク生成 ───────────────────────────────────────────────────────
function chunk(type, data) {
  const t = Buffer.from(type);
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([l, t, d, crcBuf]);
}

// ── PNG 生成（RGBA） ───────────────────────────────────────────────────────
function makePNG(pixels, size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      row[1 + x*4    ] = (p >> 24) & 0xFF;
      row[1 + x*4 + 1] = (p >> 16) & 0xFF;
      row[1 + x*4 + 2] = (p >>  8) & 0xFF;
      row[1 + x*4 + 3] =  p        & 0xFF;
    }
    rows.push(row);
  }
  const raw  = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth, RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── アイコン描画 ───────────────────────────────────────────────────────────
function hex2rgba(hex, a = 255) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function drawIcon(size) {
  const pixels = new Uint32Array(size * size);
  const BG     = hex2rgba('#0d0d0d');
  const GOLD   = hex2rgba('#f0b429');
  const GOLD2  = hex2rgba('#c49020');
  const WHITE  = hex2rgba('#ffffff');

  const s = size;
  const cx = s / 2, cy = s / 2;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      pixels[y * s + x] = BG;
    }
  }

  // 外側の円（ゴールドリング）
  const outer = s * 0.46, inner = s * 0.38;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist <= outer && dist > inner) pixels[y*s+x] = GOLD;
    }
  }

  // 内側の円（暗い）
  const fill = s * 0.36;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx*dx + dy*dy) <= fill) pixels[y*s+x] = hex2rgba('#161616');
    }
  }

  // 本のアイコン（シンプルな長方形群）
  const bw = s * 0.32, bh = s * 0.34;
  const bx = Math.round(cx - bw/2), by = Math.round(cy - bh/2);

  // 本の背表紙
  for (let y = 0; y < Math.round(bh); y++) {
    for (let x = 0; x < Math.round(bw); x++) {
      const px = bx + x, py = by + y;
      if (px >= 0 && px < s && py >= 0 && py < s) {
        pixels[py * s + px] = GOLD;
      }
    }
  }
  // 本のページ部分（白）
  const pw = s * 0.24, ph = s * 0.28;
  const px0 = Math.round(cx - pw/2 + s*0.02), py0 = Math.round(cy - ph/2);
  for (let y = 0; y < Math.round(ph); y++) {
    for (let x = 0; x < Math.round(pw); x++) {
      const px = px0 + x, py = py0 + y;
      if (px >= 0 && px < s && py >= 0 && py < s) {
        pixels[py * s + px] = hex2rgba('#fafafa');
      }
    }
  }
  // 背表紙ライン
  const lw = Math.max(1, Math.round(s * 0.03));
  for (let y = 0; y < Math.round(bh); y++) {
    for (let x = 0; x < lw; x++) {
      const px = bx + x, py = by + y;
      if (px >= 0 && px < s && py >= 0 && py < s) pixels[py*s+px] = GOLD2;
    }
  }
  // ページ罫線
  const lines = 4;
  for (let l = 0; l < lines; l++) {
    const ly = py0 + Math.round((ph / (lines + 1)) * (l + 1));
    for (let x = 0; x < Math.round(pw); x++) {
      const lx = px0 + x;
      if (lx >= 0 && lx < s && ly >= 0 && ly < s) pixels[ly*s+lx] = hex2rgba('#cccccc');
    }
  }

  return pixels;
}

// ── 生成実行 ───────────────────────────────────────────────────────────────
for (const size of [192, 512]) {
  const pixels = drawIcon(size);
  const png    = makePNG(pixels, size);
  fs.writeFileSync(`icon-${size}.png`, png);
  console.log(`✅ icon-${size}.png 生成完了`);
}
