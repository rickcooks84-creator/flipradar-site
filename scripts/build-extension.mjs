// ─── Package the FlipSonar eBay Connector ────────────────────────────────────
//
//   node scripts/build-extension.mjs
//
// Two jobs:
//   1. Copy app/lib/ebay-dom.js into the extension. That file is the shared contract for
//      eBay's page shape, and the server parses with it too — copying rather than
//      duplicating is what stops the two sides from drifting apart, which is the failure
//      mode that silently zeroes out comps.
//   2. Zip the extension into public/ so the site can hand it to a user directly.
//
// The zip is written by hand rather than shelling out to `Compress-Archive` or adding a
// dependency: this has to run the same on the Windows box it's developed on and on a
// Linux CI box, and a build tool that only works in one place is a build tool that breaks
// at the worst moment.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const SHARED_SRC = path.join(ROOT, 'app', 'lib', 'ebay-dom.js');
const SHARED_DEST = path.join(EXT, 'lib', 'ebay-dom.js');
const OUT_ZIP = path.join(ROOT, 'public', 'flipsonar-ebay-connector.zip');

const BANNER = `// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  GENERATED FILE — DO NOT EDIT.                                           ║
// ║  Source: app/lib/ebay-dom.js   Regenerate: npm run ext:build             ║
// ║  Edits here are silently overwritten and will make the extension and the ║
// ║  server disagree about how to read eBay.                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

`;

// ─── 1. Sync the shared eBay contract ────────────────────────────────────────
fs.mkdirSync(path.dirname(SHARED_DEST), { recursive: true });
fs.writeFileSync(SHARED_DEST, BANNER + fs.readFileSync(SHARED_SRC, 'utf8'));
console.log('synced  extension/lib/ebay-dom.js  <-  app/lib/ebay-dom.js');

// ─── 2. Zip it ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Every file in the extension folder, as repo-relative posix paths. */
function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

// DOS timestamp. Fixed rather than "now" so the same source produces a byte-identical
// zip — a rebuild that changes nothing should not look like a new release.
const DOS_TIME = 0;
const DOS_DATE = 0x2821; // 2020-01-01

const names = walk(EXT).sort();
const locals = [];
const centrals = [];
let offset = 0;

for (const name of names) {
  const raw = fs.readFileSync(path.join(EXT, name));
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  // Only compress when it actually helps; tiny or already-compressed files (the PNG) get
  // bigger through deflate.
  const useDeflate = deflated.length < raw.length;
  const data = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);            // version needed
  local.writeUInt16LE(0, 6);             // flags
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);            // extra length
  locals.push(local, nameBuf, data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);          // version made by
  central.writeUInt16LE(20, 6);          // version needed
  central.writeUInt16LE(0, 8);           // flags
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);          // extra
  central.writeUInt16LE(0, 32);          // comment
  central.writeUInt16LE(0, 34);          // disk start
  central.writeUInt16LE(0, 36);          // internal attrs
  central.writeUInt32LE(0, 38);          // external attrs
  central.writeUInt32LE(offset, 42);     // local header offset
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + data.length;
}

const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);                       // this disk
eocd.writeUInt16LE(0, 6);                       // disk with central dir
eocd.writeUInt16LE(names.length, 8);
eocd.writeUInt16LE(names.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);                      // comment length

fs.mkdirSync(path.dirname(OUT_ZIP), { recursive: true });
fs.writeFileSync(OUT_ZIP, Buffer.concat([...locals, centralBuf, eocd]));

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const kb = (fs.statSync(OUT_ZIP).size / 1024).toFixed(1);
console.log(`packed  public/flipsonar-ebay-connector.zip  v${manifest.version}  ${names.length} files  ${kb} KB`);
