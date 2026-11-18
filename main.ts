import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, type Snapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function option(name: string, fallback: string) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}

const root = fileURLToPath(new URL('.', import.meta.url));
const input = option('input', '/input');
const output = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot: Snapshot = JSON.parse(readFileSync(input.endsWith('.json') ? input : join(input, 'snapshot.json'), 'utf8'));
const radar = buildRadar(snapshot);

for (const directory of ['dashboard', 'screenshots']) {
  const source = join(root, directory);
  const destination = join(output, directory);
  mkdirSync(destination, { recursive: true });
  for (const file of readdirSync(source, { withFileTypes: true })) {
    if (file.isFile() && !file.name.startsWith('.')) copyFileSync(join(source, file.name), join(destination, file.name));
  }
}

writeFileSync(join(output, 'board.json'), JSON.stringify({ rows: radar.rows }) + '\n');
writeFileSync(join(output, 'data.js'), 'window.RADAR = ' + JSON.stringify(radar).replaceAll('<', '\\u003c') + ';\n');
writeFileSync(join(output, 'dossier.json'), buildDossier(output, { text_max_bytes: 65_536 }));
console.log(`Generated ${radar.rows.length} ranked protocols, ${radar.watchlistCount} watchlist entries and ${radar.reference.length} token-recorded protocols in ${output}`);
