import { hash as digest } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export const ZERO = '0'.repeat(40);
export const hash = bytes => digest('sha1', bytes, 'hex');
const TYPES = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };
const TYPE_CODES = { commit: 1, tree: 2, blob: 3, tag: 4 };
const TREE_LEAF = Symbol('file');
const MAX_INFLATED = 256 * 1024 * 1024;

export function pkt(bytes) {
  bytes = Buffer.from(bytes);
  if (bytes.length > 65516) throw Error('Packet exceeds 65520 bytes');
  const header = (bytes.length + 4).toString(16).padStart(4, '0');
  return Buffer.concat([Buffer.from(header), bytes]);
}

/** null is flush, 1 is the v2 section delimiter. */
export function lines(values) {
  const payloads = values.map(value => typeof value === 'string' ? Buffer.from(value) : value);
  const size = payloads.reduce((total, value) => total + 4 + (value?.length ?? 0), 0);
  const result = Buffer.allocUnsafe(size);
  let offset = 0;
  for (const value of payloads) {
    const length = value === null ? 0 : value === 1 ? 1 : value.length + 4;
    if (length > 65520) throw Error('Packet exceeds 65520 bytes');
    result.write(length.toString(16).padStart(4, '0'), offset, 4, 'ascii');
    offset += 4;
    if (Buffer.isBuffer(value)) { value.copy(result, offset); offset += value.length; }
  }
  return result;
}

/** Receive-pack's binary pack follows the command-list flush. */
export function packets(bytes) {
  let offset = 0;
  const out = [];
  while (offset + 4 <= bytes.length) {
    const header = bytes.toString('ascii', offset, offset + 4);
    if (!/^[0-9a-f]{4}$/i.test(header)) throw Error('Invalid packet length');
    const size = parseInt(header, 16);
    offset += 4;
    if (size <= 2) {
      out.push(null);
      if (size === 0 && bytes.toString('ascii', offset, offset + 4) === 'PACK') break;
      continue;
    }
    if (size < 4 || offset + size - 4 > bytes.length) throw Error('Truncated pkt-line');
    out.push(bytes.subarray(offset, offset + size - 4));
    offset += size - 4;
  }
  if (offset !== bytes.length && bytes.toString('ascii', offset, offset + 4) !== 'PACK') {
    throw Error('Trailing packet bytes');
  }
  return { out, offset };
}

/** Immutable Git objects are shared across repositories; refs remain repository-local. */
export class Objects {
  items = new Map();
  packed = new Map();
  generation = 0;

  put(type, input) {
    if (!TYPE_CODES[type]) throw Error('Unsupported object type');
    const data = Buffer.from(input);
    const sha = hash(Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data]));
    if (!this.items.has(sha)) {
      this.items.set(sha, { type, data });
      this.generation++;
    }
    return sha;
  }

  get(id) { return this.items.get(id); }

  commit(id) {
    const object = this.get(id);
    if (!object || object.type !== 'commit') return null;
    if (object.commit) return object.commit;
    const raw = object.data.toString();
    const split = raw.indexOf('\n\n');
    const headers = raw.slice(0, split);
    return object.commit = {
      tree: headers.match(/^tree (\w+)/m)?.[1],
      parents: [...headers.matchAll(/^parent (\w+)/gm)].map(match => match[1]),
      message: raw.slice(split + 2), raw,
    };
  }

  entries(id) {
    const object = this.get(id);
    if (!object) return [];
    if (object.entries) return object.entries;
    const data = object.data;
    let offset = 0;
    const entries = [];
    while (offset < data.length) {
      const space = data.indexOf(32, offset);
      const zero = data.indexOf(0, space);
      if (space < 0 || zero < 0 || zero + 21 > data.length) throw Error('Invalid tree');
      entries.push({
        mode: data.toString('ascii', offset, space),
        name: data.toString('utf8', space + 1, zero),
        sha: data.subarray(zero + 1, zero + 21).toString('hex'),
      });
      offset = zero + 21;
    }
    return object.entries = entries;
  }

  files(id) {
    const commit = this.commit(id);
    const files = new Map();
    const walk = (tree, prefix = '') => {
      for (const entry of this.entries(tree)) {
        if (entry.mode === '40000' || entry.mode === '040000') walk(entry.sha, prefix + entry.name + '/');
        else files.set(prefix + entry.name, { sha: entry.sha, mode: entry.mode });
      }
    };
    if (commit) walk(commit.tree);
    return files;
  }

  tree(files) {
    // Null prototypes permit ordinary filenames such as '__proto__' and 'constructor'.
    const root = Object.create(null);
    for (const [path, entry] of files) {
      let directory = root;
      const parts = path.split('/');
      for (const name of parts.slice(0, -1)) {
        directory = directory[name] ??= Object.create(null);
        if (directory[TREE_LEAF]) throw Error('File and directory paths overlap');
      }
      const name = parts.at(-1);
      if (directory[name] && !directory[name][TREE_LEAF]) throw Error('File and directory paths overlap');
      directory[name] = { ...entry, [TREE_LEAF]: true };
    }
    const build = directory => {
      const entries = Object.entries(directory).map(([name, entry]) => entry[TREE_LEAF]
        ? { name, mode: entry.mode || '100644', sha: entry.sha }
        : { name, mode: '40000', sha: build(entry) });
      // Git compares directory names as if they ended in '/', using byte order.
      entries.sort((a, b) => Buffer.compare(
        Buffer.from(a.name + (a.mode === '40000' ? '/' : '')),
        Buffer.from(b.name + (b.mode === '40000' ? '/' : '')),
      ));
      return this.put('tree', Buffer.concat(entries.map(entry => Buffer.concat([
        Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.sha, 'hex'),
      ]))));
    };
    return build(root);
  }

  makeCommit(files, parents, message, author = 'Relay Forge <relay@example.invalid>', time = 1700000000) {
    const tree = this.tree(files);
    const ancestry = parents.map(id => `parent ${id}\n`).join('');
    return this.put('commit', `tree ${tree}\n${ancestry}author ${author} ${time} +0000\ncommitter ${author} ${time} +0000\n\n${message}\n`);
  }

  ancestor(old, tip) {
    const todo = [tip], seen = new Set();
    while (todo.length) {
      const id = todo.pop();
      if (id === old) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      todo.push(...(this.commit(id)?.parents || []));
    }
    return false;
  }

  mergeBase(a, b) {
    const ancestors = new Set(), todo = [a];
    while (todo.length) {
      const id = todo.pop();
      if (ancestors.has(id)) continue;
      ancestors.add(id);
      todo.push(...(this.commit(id)?.parents || []));
    }
    const queue = [b], seen = new Set();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      if (ancestors.has(id)) return id;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(this.commit(id)?.parents || []));
    }
    return null;
  }

  closure(tips, depth = Infinity, shallow = new Set()) {
    const ids = new Set(), boundary = [];
    // Exhaust each commit generation before reading parents. A commit reachable
    // along two routes belongs at its shortest distance from any wanted tip.
    let current = [...tips], next = [], generation = 1;
    while (current.length) {
      const id = current.pop();
      if (!ids.has(id)) {
        const object = this.get(id);
        if (object) {
          ids.add(id);
          if (object.type === 'commit') {
            const commit = this.commit(id);
            current.push(commit.tree);
            if (generation < depth && !shallow.has(id)) next.push(...commit.parents);
            else if (commit.parents.length) boundary.push(id);
          } else if (object.type === 'tree') {
            for (const entry of this.entries(id)) {
              if (entry.mode !== '160000') current.push(entry.sha);
            }
          } else if (object.type === 'tag') {
            current.push(object.data.toString().match(/^object (\w+)/)?.[1]);
          }
        }
      }
      if (!current.length) { current = next; next = []; generation++; }
    }
    return { ids, boundary };
  }

  pack(ids) {
    const header = Buffer.alloc(12);
    header.write('PACK'); header.writeUInt32BE(2, 4); header.writeUInt32BE(ids.size, 8);
    const parts = [header];
    for (const id of ids) {
      const object = this.get(id);
      let compressed = this.packed.get(id);
      if (!compressed) {
        let size = object.data.length;
        const bytes = [(TYPE_CODES[object.type] << 4) | (size & 15)];
        size = Math.floor(size / 16);
        if (size) bytes[0] |= 128;
        while (size) {
          const byte = size & 127;
          size = Math.floor(size / 128);
          bytes.push(byte | (size ? 128 : 0));
        }
        compressed = Buffer.concat([Buffer.from(bytes), deflateSync(object.data, { level: 1 })]);
        this.packed.set(id, compressed);
      }
      parts.push(compressed);
    }
    const body = Buffer.concat(parts);
    return Buffer.concat([body, Buffer.from(hash(body), 'hex')]);
  }

  unpack(bytes) {
    if (bytes.length < 32 || bytes.toString('ascii', 0, 4) !== 'PACK') throw Error('Invalid pack');
    if (![2, 3].includes(bytes.readUInt32BE(4))) throw Error('Unsupported pack version');
    const trailer = bytes.length - 20;
    if (hash(bytes.subarray(0, trailer)) !== bytes.subarray(trailer).toString('hex')) throw Error('Pack checksum mismatch');
    const count = bytes.readUInt32BE(8);
    let offset = 12, inflatedBytes = 0;
    const entries = [], byOffset = new Map(), staged = new Map();
    for (let index = 0; index < count; index++) {
      const start = offset;
      let byte = bytes[offset++], type = (byte >> 4) & 7, size = byte & 15, shift = 4;
      while (byte & 128) {
        if (offset >= trailer || shift > 49) throw Error('Invalid pack size');
        byte = bytes[offset++]; size += (byte & 127) * 2 ** shift; shift += 7;
      }
      if (size > MAX_INFLATED || ![1, 2, 3, 4, 6, 7].includes(type)) throw Error('Invalid pack entry');
      let base;
      if (type === 6) {
        let byte = bytes[offset++], distance = byte & 127;
        while (byte & 128) {
          if (offset >= trailer) throw Error('Truncated delta offset');
          byte = bytes[offset++]; distance = ((distance + 1) * 128) + (byte & 127);
        }
        base = start - distance;
        if (!byOffset.has(base)) throw Error('Invalid delta offset');
      }
      if (type === 7) {
        if (offset + 20 >= trailer) throw Error('Truncated delta base');
        base = bytes.subarray(offset, offset + 20).toString('hex'); offset += 20;
      }
      // A small output buffer avoids the default 16 KiB allocation for every
      // tiny object. Cap the first allocation even if the pack claims a huge size.
      const result = inflateSync(bytes.subarray(offset, trailer), {
        info: true,
        chunkSize: Math.max(64, Math.min(16384, size + 1)),
        maxOutputLength: Math.max(1, size),
      });
      offset += result.engine.bytesWritten;
      inflatedBytes += result.buffer.length;
      if (result.buffer.length !== size || inflatedBytes > MAX_INFLATED) throw Error('Pack object size limit');
      const entry = { type, data: result.buffer, base };
      entries.push(entry); byOffset.set(start, entry);
    }
    if (offset !== trailer) throw Error('Trailing pack bytes');
    const lookup = id => staged.get(id) || this.get(id);
    const resolve = entry => {
      if (!entry) throw Error('Missing delta base');
      if (entry.id) return lookup(entry.id);
      if (entry.busy) throw Error('Delta cycle');
      entry.busy = true;
      let type = TYPES[entry.type], data = entry.data;
      if (entry.type === 6 || entry.type === 7) {
        let parent = typeof entry.base === 'number' ? resolve(byOffset.get(entry.base)) : lookup(entry.base);
        if (!parent) {
          // A REF_DELTA may name an object appearing later in the pack.
          for (const other of entries) if (other !== entry && !other.busy) resolve(other);
          parent = lookup(entry.base);
        }
        if (!parent) throw Error('Missing delta base');
        type = parent.type; data = applyDelta(parent.data, data);
      }
      const id = hash(Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data]));
      entry.id = id; entry.busy = false;
      staged.set(id, { type, data });
      return staged.get(id);
    };
    for (const entry of entries) resolve(entry);
    // A malformed pack never partially inserts objects or moves any ref.
    for (const [id, object] of staged) {
      if (this.items.has(id)) continue;
      // Node's zlib output is a view over its work buffer. Retain only the object.
      object.data = Buffer.from(object.data);
      this.items.set(id, object);
      this.generation++;
    }
  }
}

function applyDelta(base, bytes) {
  let offset = 0;
  const size = () => {
    let value = 0, shift = 0, byte;
    do {
      if (offset >= bytes.length || shift > 49) throw Error('Truncated delta size');
      byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    return value;
  };
  if (size() !== base.length) throw Error('Delta base size mismatch');
  const length = size(), parts = [];
  if (length > MAX_INFLATED) throw Error('Delta output too large');
  let written = 0;
  while (offset < bytes.length) {
    const command = bytes[offset++];
    let part;
    if (command & 128) {
      let start = 0, count = 0;
      for (let i = 0; i < 4; i++) if (command & (1 << i)) start += bytes[offset++] * 2 ** (8 * i);
      for (let i = 0; i < 3; i++) if (command & (16 << i)) count += bytes[offset++] * 2 ** (8 * i);
      count ||= 65536;
      if (!Number.isFinite(start + count) || start + count > base.length) throw Error('Invalid delta copy');
      part = base.subarray(start, start + count);
    } else if (command) {
      if (offset + command > bytes.length) throw Error('Truncated delta insert');
      part = bytes.subarray(offset, offset + command); offset += command;
    } else throw Error('Invalid delta opcode');
    written += part.length;
    if (written > length) throw Error('Delta output size mismatch');
    parts.push(part);
  }
  if (written !== length) throw Error('Delta output size mismatch');
  return Buffer.concat(parts, length);
}
