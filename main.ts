import { copyFileSync, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const source = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const requiredAssets = ['index.html', 'style.css', 'src/main.js', 'src/world.js', 'src/render.js', 'src/audio.js'];
const screenshotLimit = 256 * 1024;

function stat(path: string) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function checkGame() {
  for (const folder of ['game', 'game/src']) {
    if (!stat(join(source, folder))?.isDirectory()) {
      throw new Error(`Restore the ${folder}/ directory from the Lantern Tide source.`);
    }
  }
  for (const asset of requiredAssets) {
    const info = stat(join(source, 'game', asset));
    if (!info?.isFile() || info.size === 0) {
      throw new Error(`Restore game/${asset} as a non-empty regular file before packaging.`);
    }
  }
}

function screenshotDimensions(bytes: Buffer): [number, number] | undefined {
  const pngSignature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') === pngSignature) {
    const pngEnd = '0000000049454e44ae426082';
    if (bytes.length >= 45 && bytes.readUInt32BE(8) === 13 &&
        bytes.toString('ascii', 12, 16) === 'IHDR' &&
        bytes.subarray(-12).toString('hex') === pngEnd) {
      return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    }
    return;
  }

  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 ||
      bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return;

  // Walk JPEG metadata up to the scan. The frame header supplies the dimensions.
  let dimensions: [number, number] | undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length >= bytes.length - 2) return;
    if (marker === 0xda) return dimensions;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return;
      dimensions = [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
}

function checkScreenshots() {
  const folder = join(source, 'screenshots');
  if (!stat(folder)?.isDirectory()) {
    throw new Error('Create screenshots/ and add 3 or 4 browser captures of Lantern Tide.');
  }

  const entries = readdirSync(folder, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.'));
  if (entries.length < 3 || entries.length > 4) {
    throw new Error(`screenshots/ contains ${entries.length} visible entries. Supply 3 or 4 browser captures and remove unrelated files.`);
  }
  for (const entry of entries) {
    const label = `screenshots/${entry.name}`;
    if (!entry.isFile() || !/^[a-z0-9_][a-z0-9._-]{0,127}$/i.test(entry.name) ||
        !/\.(png|jpe?g)$/i.test(entry.name)) {
      throw new Error(`Replace ${label} with a regular PNG or JPEG using letters, digits, dots, underscores or hyphens in its name.`);
    }
    const path = join(folder, entry.name);
    if (lstatSync(path).size > screenshotLimit) {
      throw new Error(`${label} exceeds 256 KiB. Export the browser capture at a lower JPEG quality.`);
    }
    const bytes = readFileSync(path);
    const isPng = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const dimensions = screenshotDimensions(bytes);
    if (!dimensions || isPng !== /\.png$/i.test(entry.name)) {
      throw new Error(`${label} has an invalid or mismatched image header or end marker. Recapture it as PNG or JPEG.`);
    }
    const [width, height] = dimensions;
    if (Math.min(width, height) < 480 || Math.max(width, height) > 1280) {
      throw new Error(`${label} is ${width}×${height}. Capture at 1200×800, or use a short side of at least 480 and a long side of at most 1280 pixels.`);
    }
  }
  return entries.map(entry => entry.name);
}

function packageEntry() {
  checkGame();
  const screenshots = checkScreenshots();
  const dossier = buildDossier(source, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: screenshotLimit },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });

  // Existing package files could carry stale assets into the judge's rebuilt dossier.
  for (const name of ['game', 'screenshots', 'dossier.json']) {
    if (stat(join(output, name))) {
      throw new Error(`Output already contains ${name}. Set MAKEFUN_OUTPUT_DIR to a fresh directory.`);
    }
  }
  mkdirSync(output, { recursive: true });
  cpSync(join(source, 'game'), join(output, 'game'), { recursive: true, verbatimSymlinks: true });
  mkdirSync(join(output, 'screenshots'));
  for (const name of screenshots) {
    copyFileSync(join(source, 'screenshots', name), join(output, 'screenshots', name));
  }
  writeFileSync(join(output, 'dossier.json'), dossier);
  console.log(`Packaged Lantern Tide with ${screenshots.length} screenshots in ${output}`);
}

try {
  packageEntry();
} catch (error) {
  console.error(`Lantern Tide packaging failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
