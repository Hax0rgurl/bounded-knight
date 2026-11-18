// Runs the unmodified published suite with the socket-free adapter.
import { createApp } from '../app.ts';
import { handlerFetch } from './transport.ts';
const kit = process.argv[2];
const perf = process.argv.includes('--perf');
if (!kit) throw Error('usage: node test/public-suite.ts /absolute/path/to/kit [--perf]');
process.env.MAKEFUN_SHOP_TOKEN = 'local-test';
globalThis.fetch = handlerFetch(createApp());
process.argv = ['node', kit + '/sdk/run.ts', '--url', 'http://local-forge', '--token', 'local-test', '--json', ...(perf ? ['--perf'] : [])];
await import(kit + '/sdk/run.ts');
