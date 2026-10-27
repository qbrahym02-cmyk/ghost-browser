/**
 * أدوات PNG خالصة بدون أي اعتماديات خارجية.
 * فك ترميز PNG (8-bit، غير متداخل)، تصغير بجودة Box-filter، وإعادة ترميز،
 * ثم بناء ملف .ICO حقيقي (BMP للأحجام الصغيرة + PNG للكبيرة).
 *
 * الهدف: أيقونة ويندوز/لينكس صحيحة متعددة المقاسات بدون imagemagick أو sharp.
 */
import zlib from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

/* ------------------------------------------------------------------ CRC32 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------- PNG decode */
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let plte = null;
  let trns = null;

  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('missing IHDR');
  if (ihdr.depth !== 8) throw new Error(`unsupported bit depth ${ihdr.depth}`);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height, colorType } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);
  const stride = width * channels;
  const px = new Uint8Array(width * height * 4);

  let prev = new Uint8Array(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r, g, b, al = 255;
      if (colorType === 6) { r = cur[x * 4]; g = cur[x * 4 + 1]; b = cur[x * 4 + 2]; al = cur[x * 4 + 3]; }
      else if (colorType === 2) { r = cur[x * 3]; g = cur[x * 3 + 1]; b = cur[x * 3 + 2]; }
      else if (colorType === 4) { r = g = b = cur[x * 2]; al = cur[x * 2 + 1]; }
      else if (colorType === 0) { r = g = b = cur[x]; }
      else { // palette
        const idx = cur[x];
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
        if (trns && idx < trns.length) al = trns[idx];
      }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = al;
    }
    prev = cur;
  }
  return { width, height, data: px };
}

/* ------------------------------------------------------------ PNG encode */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- resize */
/** تصغير بمرشّح Box (متوسط المساحة) — مثالي للأيقونات. */
export function resize(img, w, h) {
  const out = new Uint8Array(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const o = (yy * img.width + xx) * 4;
          r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; a += img.data[o + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

/* ------------------------------------------------------------------ ICO */
/** بناء ملف ICO: BMP (BGRA + AND mask) للأحجام ≤48، وPNG للأكبر. */
export function buildIco(images) {
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    let payload;
    const usePng = img.width > 48;
    if (usePng) {
      payload = encodePng(img.width, img.height, img.data);
    } else {
      const header = Buffer.alloc(40);
      header.writeUInt32BE(40, 0);
      header.writeInt32LE(img.width, 4);
      header.writeInt32LE(img.height * 2, 8); // XOR + AND
      header.writeUInt16LE(1, 12);
      header.writeUInt16LE(32, 14);
      const xor = Buffer.alloc(img.width * img.height * 4);
      for (let y = 0; y < img.height; y++) { // صفوف من الأسفل للأعلى
        for (let x = 0; x < img.width; x++) {
          const s = (y * img.width + x) * 4;
          const d = ((img.height - 1 - y) * img.width + x) * 4;
          xor[d] = img.data[s + 2]; xor[d + 1] = img.data[s + 1];
          xor[d + 2] = img.data[s]; xor[d + 3] = img.data[s + 3];
        }
      }
      const andStride = Math.ceil(img.width / 8);
      const andPad = (4 - (andStride % 4)) % 4;
      const and = Buffer.alloc((andStride + andPad) * img.height);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const alpha = img.data[(y * img.width + x) * 4 + 3];
          if (alpha < 8) {
            const row = img.height - 1 - y;
            const o = row * (andStride + andPad) + (x >> 3);
            and[o] |= 0x80 >> (x & 7);
          }
        }
      }
      payload = Buffer.concat([header, xor, and]);
    }
    entries.push({ img, payload, offset, usePng });
    offset += payload.length;
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(images.length * 16);
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.img.width >= 256 ? 0 : e.img.width;
    dir[o + 1] = e.img.height >= 256 ? 0 : e.img.height;
    dir[o + 2] = 0; dir[o + 3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(e.payload.length, 8);
    dir.writeUInt32LE(e.offset, 12);
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.payload)]);
}

export function loadPng(path) {
  return decodePng(readFileSync(path));
}

export function writePng(path, img) {
  writeFileSync(path, encodePng(img.width, img.height, img.data));
}

export function writeIco(path, images) {
  writeFileSync(path, buildIco(images));
}
