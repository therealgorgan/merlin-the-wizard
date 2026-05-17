// Downloads original Merlin agent assets from the canonical clippyjs GitHub
// (served via jsDelivr) and prepares tray/installer icons by cropping the
// first 128x128 frame of the sprite sheet (Merlin's RestPose).
//
// Run with: npm run assets
// Idempotent: skips download if a file already exists. Pass --force to re-fetch.

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// All clippyjs characters. Merlin stays the icon source.
const CHARACTERS = [
  'Merlin',
  'Clippy',
  'Bonzi',
  'F1',
  'Genie',
  'Genius',
  'Links',
  'Peedy',
  'Rocky',
  'Rover',
];
const ICON_CHARACTER = 'Merlin';
const CDN = 'https://cdn.jsdelivr.net/gh/clippyjs/clippy.js@master/agents';
const FILES = ['agent.js', 'map.png', 'sounds-mp3.js', 'sounds-ogg.js'];

const FORCE = process.argv.includes('--force');

const AGENTS_ROOT = join(ROOT, 'src/renderer/public/agents');
const ICON_PNG = join(ROOT, 'resources/icon.png');
const ICON_ICO = join(ROOT, 'resources/icon.ico');

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadOne(character, name) {
  const dest = join(AGENTS_ROOT, character, name);
  if (!FORCE && (await exists(dest))) {
    console.log(`  skip   ${character}/${name}`);
    return;
  }
  const url = `${CDN}/${character}/${name}`;
  process.stdout.write(`  fetch  ${character}/${name} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${buf.length} bytes`);
}

async function downloadAll() {
  for (const char of CHARACTERS) {
    await mkdir(join(AGENTS_ROOT, char), { recursive: true });
    console.log(`Downloading ${char}`);
    for (const f of FILES) {
      try {
        await downloadOne(char, f);
      } catch (err) {
        console.warn(`  WARN   ${char}/${f}: ${err.message}`);
      }
    }
  }
}

async function buildIcons() {
  console.log(`Building icons from ${ICON_CHARACTER}/map.png`);
  await mkdir(dirname(ICON_PNG), { recursive: true });

  const mapPath = join(AGENTS_ROOT, ICON_CHARACTER, 'map.png');
  const mapBuf = await readFile(mapPath);
  const map = await Jimp.read(mapBuf);

  // First frame of RestPose is at [0, 0], framesize 128x128 (confirmed via agent.js).
  const frame = map.clone().crop(0, 0, 128, 128);

  const png256 = await frame
    .clone()
    .resize(256, 256, Jimp.RESIZE_NEAREST_NEIGHBOR)
    .getBufferAsync(Jimp.MIME_PNG);
  await writeFile(ICON_PNG, png256);
  console.log(`  wrote  resources/icon.png (256x256)`);

  const buffers = [];
  for (const size of ICON_SIZES) {
    const buf = await frame
      .clone()
      .resize(size, size, Jimp.RESIZE_NEAREST_NEIGHBOR)
      .getBufferAsync(Jimp.MIME_PNG);
    buffers.push(buf);
  }
  const ico = await pngToIco(buffers);
  await writeFile(ICON_ICO, ico);
  console.log(`  wrote  resources/icon.ico (${ICON_SIZES.join(', ')})`);
}

async function main() {
  await downloadAll();
  await buildIcons();
  console.log('Done.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
