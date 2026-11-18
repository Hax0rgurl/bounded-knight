import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { Objects, hash, lines, ZERO } from '../objects.ts';
import { Store } from '../store.ts';
import { git, validRef } from '../git.ts';
import { createApp } from '../app.ts';
import { handlerFetch } from './transport.ts';
import { graphql } from '../graphql.ts';
import { mcp } from '../mcp.ts';

function fixture() {
  const store = new Store();
  store.bind('octopus');
  const repo = store.create({ name: 'garden' });
  const files = new Map([['seed.txt', { sha: store.objects.put('blob', 'seed\n') }]]);
  const root = store.objects.makeCommit(files, [], 'Root');
  repo.refs.set('refs/heads/main', root);
  return { store, repo, files, root };
}

// Independently construct packs, including both delta representations.
function rawPack(entries) {
  const header = Buffer.alloc(12);
  header.write('PACK'); header.writeUInt32BE(2, 4); header.writeUInt32BE(entries.length, 8);
  const parts = [header];
  for (const { type, data, base } of entries) {
    let n = data.length;
    const bytes = [(type << 4) | (n & 15)];
    n >>>= 4;
    if (n) bytes[0] |= 128;
    while (n) { const byte = n & 127; n >>>= 7; bytes.push(byte | (n ? 128 : 0)); }
    parts.push(Buffer.from(bytes));
    if (base) parts.push(base);
    parts.push(deflateSync(data));
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, Buffer.from(hash(body), 'hex')]);
}

test('SHA-1 object framing and exact binary pack round trip', () => {
  const source = new Objects(), target = new Objects();
  assert.equal(source.put('blob', ''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  const id = source.put('blob', Buffer.from([0, 255, 128, 10]));
  target.unpack(source.pack(new Set([id])));
  assert.deepEqual(target.get(id), source.get(id));
});

test('nested trees preserve unusual names, binary content and executable modes', () => {
  const objects = new Objects();
  const files = new Map([
    ['__proto__/constructor', { sha: objects.put('blob', 'safe'), mode: '100755' }],
    ['a/leaf', { sha: objects.put('blob', 'leaf') }],
    ['a/deeper/x', { sha: objects.put('blob', Buffer.from([255, 0])) }],
    ['é.txt', { sha: objects.put('blob', 'unicode') }],
  ]);
  const id = objects.makeCommit(files, [], 'Tree');
  const read = objects.files(id);
  assert.equal(read.size, 4);
  for (const [path, entry] of files) assert.equal(read.get(path).sha, entry.sha);
  assert.equal(read.get('__proto__/constructor').mode, '100755');
});

test('REF_DELTA can resolve an existing thin-pack base', () => {
  const objects = new Objects();
  const base = objects.put('blob', 'hello');
  const delta = Buffer.from([5, 6, 0x90, 5, 1, 33]); // copy five bytes, insert '!'
  objects.unpack(rawPack([{ type: 7, data: delta, base: Buffer.from(base, 'hex') }]));
  const wanted = hash(Buffer.from('blob 6\0hello!'));
  assert.equal(objects.get(wanted).data.toString(), 'hello!');
  assert.equal(objects.items.size, 2);
});

test('REF_DELTA supports forward pack references', () => {
  const objects = new Objects(), baseData = Buffer.from('hello');
  const base = hash(Buffer.concat([Buffer.from('blob 5\0'), baseData]));
  objects.unpack(rawPack([
    { type: 7, data: Buffer.from([5, 6, 0x90, 5, 1, 33]), base: Buffer.from(base, 'hex') },
    { type: 3, data: baseData },
  ]));
  assert.equal(objects.items.size, 2);
  assert.ok([...objects.items.values()].some(object => object.data.toString() === 'hello!'));
});

test('OFS_DELTA resolves a preceding packed object', () => {
  const objects = new Objects(), baseData = Buffer.from('hello');
  const firstLength = 1 + deflateSync(baseData).length;
  objects.unpack(rawPack([
    { type: 3, data: baseData },
    { type: 6, data: Buffer.from([5, 6, 0x90, 5, 1, 33]), base: Buffer.from([firstLength]) },
  ]));
  assert.equal(objects.items.size, 2);
  assert.ok([...objects.items.values()].some(object => object.data.toString() === 'hello!'));
});

test('invalid pack checksum and late invalid delta leave the object store unchanged', () => {
  const objects = new Objects();
  const corrupt = rawPack([{ type: 3, data: Buffer.from('good') }]);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => objects.unpack(corrupt), /checksum/);
  const bad = rawPack([
    { type: 3, data: Buffer.from('good') },
    { type: 7, data: Buffer.from([4, 1, 0]), base: Buffer.alloc(20, 1) },
  ]);
  assert.throws(() => objects.unpack(bad), /base/);
  assert.equal(objects.items.size, 0);
});

test('a mixed push accepts a fast-forward and rejects a rewind independently', () => {
  const { store, repo, files, root } = fixture();
  const second = store.objects.makeCommit(files, [root], 'Second');
  repo.refs.set('refs/heads/other', second);
  const input = lines([
    `${root} ${second} refs/heads/main\0report-status side-band-64k\n`,
    `${second} ${root} refs/heads/other\n`, null,
  ]);
  git(store, repo, 'git-receive-pack', 'POST', Buffer.concat([input, store.objects.pack(new Set())]), 0);
  assert.equal(repo.refs.get('refs/heads/main'), second);
  assert.equal(repo.refs.get('refs/heads/other'), second);
});

test('squash merge preserves changes made independently on the base branch', () => {
  const { store, repo, files, root } = fixture();
  const headFiles = new Map(files);
  headFiles.set('feature.txt', { sha: store.objects.put('blob', 'feature') });
  repo.refs.set('refs/heads/feature', store.objects.makeCommit(headFiles, [root], 'Feature'));
  const baseFiles = new Map(files);
  baseFiles.set('base.txt', { sha: store.objects.put('blob', 'base') });
  const base = store.objects.makeCommit(baseFiles, [root], 'Base');
  repo.refs.set('refs/heads/main', base);
  const pull = store.pull(repo, { head: 'feature', base: 'main', title: 'Merge feature' });
  const merged = store.merge(repo, pull);
  const finalFiles = store.objects.files(merged.sha);
  assert.ok(finalFiles.has('feature.txt'));
  assert.ok(finalFiles.has('base.txt'));
  assert.deepEqual(store.objects.commit(merged.sha).parents, [base]);
});

test('conflicting merge leaves the base ref and pull state intact', () => {
  const { store, repo, files, root } = fixture();
  const commit = text => store.objects.makeCommit(new Map([['seed.txt', { sha: store.objects.put('blob', text) }]]), [root], text);
  repo.refs.set('refs/heads/feature', commit('feature'));
  const pull = store.pull(repo, { head: 'feature', base: 'main', title: 'Conflict' });
  const base = commit('base'); repo.refs.set('refs/heads/main', base);
  assert.throws(() => store.merge(repo, pull), error => error.status === 405);
  assert.equal(repo.refs.get('refs/heads/main'), base);
  assert.equal(pull.state, 'open');
});

test('REST rejects foreign owners, stale SHA, overlapping paths and unknown suffixes', () => {
  const { store, repo, root } = fixture();
  const path = '/api/v3/repos/octopus/garden';
  assert.throws(() => store.repo('stranger', 'garden'), error => error.status === 404);
  assert.throws(() => store.rest('PUT', path + '/contents/seed.txt', { sha: ZERO, content: 'eA==' }), error => error.status === 409);
  assert.throws(() => store.rest('PUT', path + '/contents/seed.txt/child', { content: 'eA==' }), error => error.status === 422);
  const issue = store.issue(repo, { title: 'Track' });
  assert.throws(() => store.rest('GET', path + `/issues/${issue.number}/unknown`), error => error.status === 404);
  assert.equal(repo.refs.get('refs/heads/main'), root);
});

test('GraphQL variables, aliases, inline inputs and unknown-field errors use the shared store', () => {
  const { store, repo } = fixture();
  const result = graphql(store, { query: 'mutation($r: ID!) { made: createIssue(input: {repositoryId: $r, title: "Fresh"}) { issue { id number } } }', variables: { r: repo.node_id } });
  assert.equal(result.data.made.issue.number, 1);
  const query = graphql(store, { query: '{ alias: repository(owner:"octopus",name:"garden") { issue(number:1) { title } } }' });
  assert.equal(query.data.alias.issue.title, 'Fresh');
  const bad = graphql(store, { query: '{ viewer { noSuchField } }' });
  assert.match(bad.errors[0].message, /noSuchField/);
});

test('MCP reports invalid JSON-RPC and missing or wrong argument types', () => {
  const { store } = fixture();
  assert.equal(mcp(store, null).error.code, -32600);
  assert.equal(mcp(store, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_issue', arguments: {} } }).error.code, -32602);
  assert.equal(mcp(store, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_repo', arguments: { name: 12 } } }).error.code, -32602);
});

test('HTTP handler enforces authentication, malformed JSON and JSON error headers', async () => {
  process.env.MAKEFUN_SHOP_TOKEN = 'unit-test-token';
  const fetch = handlerFetch(createApp());
  let result = await fetch('http://forge/api/v3/meta');
  assert.equal(result.status, 401);
  assert.ok(result.headers.get('x-github-request-id'));
  result = await fetch('http://forge/api/v3/meta', { headers: { authorization: 'Bearer incorrect' } });
  assert.equal(result.status, 401);
  const headers = { authorization: 'Bearer unit-test-token' };
  result = await fetch('http://forge/mcp', { method: 'POST', headers, body: '{' });
  assert.equal(result.status, 400);
  assert.equal((await result.json()).error.code, -32700);
  result = await fetch('http://forge/api/v3/user/repos', { method: 'POST', headers, body: 'null' });
  assert.equal(result.status, 400);
});

test('invalid Git ref names are refused', () => {
  for (const ref of ['refs/heads/../x', 'refs/heads/a.lock', 'refs/heads/a b', 'refs/heads/.hidden', 'HEAD']) assert.equal(validRef(ref), false);
  assert.equal(validRef('refs/heads/feature/useful'), true);
});

test('cached issue reads reflect GraphQL mutations and REST comments', () => {
  const { store, repo } = fixture();
  const issue = store.issue(repo, { title: 'Track changes' });
  const route = '/api/v3/repos/octopus/garden/issues/' + issue.number;
  const read = () => JSON.parse(store.rest('GET', route).serialized.toString());
  assert.equal(read().state, 'open');
  const result = graphql(store, {
    query: 'mutation { closeIssue(input: {issueId: "' + issue.node_id + '"}) { issue { state } } }',
  });
  assert.equal(result.data.closeIssue.issue.state, 'CLOSED');
  assert.equal(read().state, 'closed');
  store.rest('POST', route + '/comments', { body: 'Acknowledged' });
  assert.equal(read().comments, 1);
});

test('fetch cache keeps distinct wants and traverses shared ancestry by shortest distance', () => {
  const { store, repo, files, root } = fixture();
  const parent = store.objects.makeCommit(files, [root], 'Parent');
  const child = store.objects.makeCommit(files, [parent], 'Child');
  const fetch = (wants, depth) => git(store, repo, 'git-upload-pack', 'POST', lines([
    'command=fetch\n', 1, ...wants.map(id => 'want ' + id + '\n'), 'deepen ' + depth + '\n', 'done\n', null,
  ]), 2).body;
  const first = fetch([child], 2);
  assert.equal(fetch([child], 2), first);
  const second = fetch([parent, child], 2);
  assert.notDeepEqual(second, first);
  assert.ok(store.objects.closure([parent, child], 2).ids.has(root));
  assert.ok(!store.objects.closure([child], 2).ids.has(root));
  assert.equal(fetch([parent, child], 2), second);
});

test('a fetch cache miss rebuilds a closure after a missing object arrives', () => {
  const { store, repo } = fixture();
  const blob = hash(Buffer.from('blob 4\0late'));
  const tip = store.objects.makeCommit(new Map([['late.txt', { sha: blob }]]), [], 'With late blob');
  const request = lines(['command=fetch\n', 1, 'want ' + tip + '\n', 'done\n', null]);
  const fetch = () => git(store, repo, 'git-upload-pack', 'POST', request, 2).body;
  const before = fetch();
  assert.equal(fetch(), before);
  assert.equal(store.objects.put('blob', 'late'), blob);
  const after = fetch();
  assert.notDeepEqual(after, before);
  assert.equal(fetch(), after);
});
