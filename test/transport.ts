import { Readable } from 'node:stream';

/** Deliver HTTP messages directly to the real listener when sockets are forbidden. */
export function handlerFetch(server) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = Object.fromEntries(new Headers(init.headers || {}));
    headers.host = url.host;
    const payload = init.body == null ? Buffer.alloc(0) : Buffer.from(init.body);
    if (payload.length && !headers['transfer-encoding'] && !headers['content-length']) {
      headers['content-length'] = String(payload.length);
    }
    const request = Readable.from(payload.length ? [payload] : []);
    Object.assign(request, { url: url.pathname + url.search, method: init.method || 'GET', headers });
    return new Promise((resolve, reject) => {
      let status = 200, replyHeaders = {};
      const chunks = [];
      const response = {
        headersSent: false,
        writeHead(code, headers) {
          status = code; replyHeaders = headers; this.headersSent = true;
          return this;
        },
        setHeader(key, value) { replyHeaders[key] = value; },
        write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
        end(chunk) {
          if (chunk) chunks.push(Buffer.from(chunk));
          resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
            status, headers: replyHeaders,
          }));
        },
      };
      try { server.emit('request', request, response); }
      catch (error) { reject(error); }
    });
  };
}
