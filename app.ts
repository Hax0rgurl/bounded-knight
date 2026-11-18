import { createServer } from 'node:http';
import { Store } from './store.ts';
import { git } from './git.ts';
import { graphql } from './graphql.ts';
import { mcp } from './mcp.ts';

export function createApp() {
  const store = new Store();
  let requestId = 0;
  return createServer(async (req, res) => {
    const json = (status, body, headers = {}) => {
      const text = status === 204 ? '' : JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'x-github-request-id': String(++requestId),
        'content-length': Buffer.byteLength(text), ...headers,
      });
      res.end(text);
    };
    try {
      const url = new URL(req.url, 'http://forge');
      const path = url.pathname, method = req.method;
      if (path === '/healthz' && method === 'GET') return json(200, { ok: true });
      const token = process.env.MAKEFUN_SHOP_TOKEN;
      if (!token || req.headers.authorization !== `Bearer ${token}`) {
        return json(401, { message: 'Bad credentials' });
      }
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 64 * 1024 * 1024) return json(413, { message: 'Request too large' });
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const match = path.match(/^\/([^/]+)\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/);
      if (match && (method === 'GET' && match[3] === 'info/refs' || method === 'POST' && match[3] !== 'info/refs')) {
        const repo = store.repo(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
        const service = method === 'GET' ? url.searchParams.get('service') : match[3];
        if (!['git-upload-pack', 'git-receive-pack'].includes(service)) return json(404, { message: 'Not Found' });
        const version = req.headers['git-protocol']?.split(':').includes('version=2') ? 2 : 0;
        const answer = git(store, repo, service, method, raw, version);
        res.writeHead(200, {
          'content-type': answer.type, 'content-length': answer.body.length,
          'cache-control': 'no-cache',
        });
        return res.end(answer.body);
      }
      let body = {};
      if (raw.length) {
        try { body = JSON.parse(raw.toString()); }
        catch {
          if (path === '/mcp') return json(400, {
            jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' },
          });
          return json(400, { message: 'Malformed JSON' });
        }
      }
      if (path === '/api/graphql' && method === 'POST') return json(200, graphql(store, body));
      if (path === '/mcp' && method === 'POST') {
        const answer = mcp(store, body);
        return json(answer === null ? 202 : 200, answer);
      }
      if (path === '/api/v3' || path.startsWith('/api/v3/')) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { message: 'Expected a JSON object' });
        const answer = store.rest(method, path, body, url.searchParams);
        if (answer.headers?.link) answer.headers.link = answer.headers.link.replace('<', '<http://' + req.headers.host);
        return json(answer.status, answer.body, answer.headers);
      }
      return json(404, { message: 'Not Found' });
    } catch (error) {
      if (!error.status) process.stderr.write(`[request] ${error.stack}\n`);
      if (!res.headersSent) json(error.status || 500, { message: error.message || 'Internal Server Error' });
      else res.end();
    }
  });
}
