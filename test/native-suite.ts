// Socket-free driver for the unmodified published suite. The Go test process
// uses httptest to deliver every request to the production net/http handler.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [kit, executable] = process.argv.slice(2);
if (!kit || !executable) throw Error('usage: node test/native-suite.ts /absolute/kit /absolute/go-test-binary [--perf]');
const perf = process.argv.includes('--perf');
const child = spawn(executable, ['-test.run=^TestPublishedBridge$'], {
  env: { ...process.env, GOOF_TEST_BRIDGE: '1' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let nextId = 0;
const pending = new Map();
createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.startsWith('{')) return;
  const reply = JSON.parse(line);
  const call = pending.get(reply.id);
  if (!call) return;
  pending.delete(reply.id);
  const headers = Object.entries(reply.headers).flatMap(([key, values]) =>
    (values as string[]).map(value => [key, value]));
  call.resolve(new Response([204, 205, 304].includes(reply.status) ? null : Buffer.from(reply.body ?? '', 'base64'), {
    status: reply.status,
    headers,
  }));
});
child.once('error', (error) => {
  for (const call of pending.values()) call.reject(error);
  pending.clear();
});
child.once('exit', (code) => {
  for (const call of pending.values()) call.reject(Error('native bridge exited: ' + code));
  pending.clear();
});
process.once('exit', () => child.kill());
globalThis.fetch = async (input, init = {}) => {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({
      id,
      url: typeof input === 'string' ? input : input.url,
      method: init.method || 'GET',
      headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body == null ? '' : Buffer.from(init.body).toString('base64'),
    }) + '\n');
  });
};
process.argv = ['node', kit + '/sdk/run.ts', '--url', 'http://local-forge', '--token', 'local-test', '--json', ...(perf ? ['--perf'] : [])];
await import(kit + '/sdk/run.ts');
