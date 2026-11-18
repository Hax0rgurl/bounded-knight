import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';
import type { Snapshot } from '../lib/radar.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/check-output.ts <snapshot.json> <output>');
const snapshot: Snapshot = JSON.parse(readFileSync(input, 'utf8'));
const fileName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const read = (name: string) => readFileSync(join(output, name));
const gate = (name: string, check: () => void) => {
  check();
  console.log(name + ' PASS');
};

gate('dashboard_files', () => {
  const directory = join(output, 'dashboard');
  const files = readdirSync(directory, { recursive: true, withFileTypes: true });
  const sources = files.filter(file => file.isFile());
  assert(sources.length <= 400 && files.every(file => fileName.test(file.name) && (file.isDirectory() || file.isFile())));
  assert(sources.some(file => file.name.endsWith('.css')) && sources.some(file => file.name.endsWith('.js')));
  assert(lstatSync(join(directory, 'index.html')).isFile());
  let bytes = 0;
  for (const file of sources) {
    const body = readFileSync(join(file.parentPath, file.name));
    bytes += body.length;
    const source = body.toString('utf8');
    if (file.name.endsWith('.css')) assert(!/https?:\/\//i.test(source));
    if (file.name.endsWith('.html')) {
      assert(!/<[^>]+\s[\w:-]+\s*=\s*(?:"[^"]*https?:\/\/|'[^']*https?:\/\/|[^\s"'<>]*https?:\/\/)/i.test(source));
      assert(!/<style\b[^>]*>[^<]*https?:\/\//i.test(source));
    }
    if (/\.(?:m?js|html)$/.test(file.name)) {
      assert(!/\b(?:import\s*(?:\(\s*|[^\n;]*?\bfrom\s+)?|from\s+|require\s*\(\s*)['"]https?:\/\//i.test(source));
    }
  }
  assert(bytes <= 4 * 1024 * 1024);
});

const board = read('board.json');
const { rows } = JSON.parse(board.toString('utf8'));
const slugs = new Set<string>();
gate('board_file', () => {
  assert(board.length <= 8 * 1024 * 1024);
  assert(Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000);
  const protocols = new Set(snapshot.protocols.map(protocol => protocol.slug));
  for (const row of rows) {
    assert(typeof row.slug === 'string' && /^\S{1,128}$/.test(row.slug));
    assert(protocols.has(row.slug) && !slugs.has(row.slug));
    slugs.add(row.slug);
    assert(typeof row.name === 'string' && row.name.trim());
    assert(Number.isInteger(row.rank) && row.rank > 0);
    assert(Number.isInteger(row.implied_value_usd) && row.implied_value_usd > 0 && row.implied_value_usd <= 100_000_000_000_000);
    assert(Array.isArray(row.farm_steps));
  }
  assert(new Set(rows.map(row => row.implied_value_usd)).size > 1);
});
gate('sorted_by_value', () => {
  const ranked = [...rows].sort((a, b) => a.rank - b.rank);
  assert(ranked.every((row, i) => row.rank === i + 1 && (!i || ranked[i - 1].implied_value_usd >= row.implied_value_usd)));
});
gate('coverage', () => assert(snapshot.watchlist.every(slug => slugs.has(slug))));
gate('farm_steps', () => {
  assert(rows.every(row => row.farm_steps.length >= 3 && row.farm_steps.length <= 12 &&
    row.farm_steps.every(step => typeof step === 'string' && step.trim().length >= 20 && step.trim().length <= 600)));
});
gate('screenshots', () => {
  const names = readdirSync(join(output, 'screenshots')).filter(name => !name.startsWith('.'));
  assert(names.length >= 3 && names.length <= 4);
  for (const name of names) {
    assert(fileName.test(name) && lstatSync(join(output, 'screenshots', name)).isFile());
    const png = read(join('screenshots', name));
    assert(png.length <= 512 * 1024);
    // This capture script produces PNGs. The vendored builder checks complete image framing.
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert(Math.min(width, height) >= 800 && Math.max(width, height) <= 1440);
  }
});
gate('dossier_matches', () => {
  const dossier = read('dossier.json');
  assert(dossier.length <= 1.5 * 1024 * 1024);
  assert(dossier.equals(buildDossier(output, { text_max_bytes: 65_536 })));
  console.log(`Dossier ${dossier.length.toLocaleString('en-US')} bytes`);
});
