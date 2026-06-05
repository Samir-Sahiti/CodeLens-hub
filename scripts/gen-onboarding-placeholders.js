const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const slugs = [
  'connecting-a-repo',
  'dependency-graph',
  'issues-panel',
  'metrics-tab',
  'dependencies-tab',
  'tours',
  'pull-requests-tab',
  'agent-search-tab',
  'settings',
];

const width = 800;
const height = 450;
const outputDir = path.join(__dirname, '..', 'frontend', 'public', 'onboarding');

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pngBuffer() {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = 1 + x * 3;
      const shade = ((Math.floor(x / 40) + Math.floor(y / 40)) % 2) ? 86 : 104;
      row[i] = shade;
      row[i + 1] = shade;
      row[i + 2] = shade;
    }
    rows.push(row);
  }

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outputDir, { recursive: true });
const image = pngBuffer();
for (const slug of slugs) {
  fs.writeFileSync(path.join(outputDir, `${slug}.png`), image);
}

console.log(`Generated ${slugs.length} onboarding placeholders in ${outputDir}`);
