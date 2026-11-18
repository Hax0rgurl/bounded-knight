import { ZERO, packets, lines } from './objects.ts';

export function validRef(ref) {
  return typeof ref === 'string' && ref.startsWith('refs/') &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(ref) && !ref.includes('..') &&
    !ref.includes('@{') && !ref.endsWith('.') &&
    ref.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

export function git(store, repo, service, method, body, version) {
  const objects = store.objects;
  const refs = () => [...repo.refs];
  const head = () => repo.refs.get('refs/heads/' + repo.default_branch);
  const result = bytes => ({
    body: bytes,
    type: `application/x-${service}-${method === 'GET' ? 'advertisement' : 'result'}`,
  });

  if (method === 'GET') {
    if (service === 'git-upload-pack' && version === 2) {
      return result(lines([
        'version 2\n', 'agent=relay/1\n', 'ls-refs=unborn\n',
        'fetch=shallow\n', 'object-format=sha1\n', null,
      ]));
    }
    const advertisement = [`# service=${service}\n`, null];
    const list = refs();
    if (head()) list.unshift(['HEAD', head()]);
    const capabilities = service === 'git-receive-pack'
      ? 'report-status side-band-64k delete-refs ofs-delta'
      : `multi_ack_detailed side-band-64k shallow ofs-delta symref=HEAD:refs/heads/${repo.default_branch}`;
    if (!list.length) advertisement.push(`${ZERO} capabilities^{}\0${capabilities}\n`);
    else list.forEach(([ref, sha], index) => {
      advertisement.push(`${sha} ${ref}${index === 0 ? '\0' + capabilities : ''}\n`);
    });
    advertisement.push(null);
    return result(lines(advertisement));
  }

  const parsed = packets(body);
  const text = parsed.out.filter(Boolean).map(bytes => bytes.toString('utf8').trimEnd());
  if (service === 'git-receive-pack') {
    const commands = text.map(line => line.split('\0')[0].split(' '));
    const sideband = text[0]?.includes('side-band-64k');
    const reportResult = report => {
      const bytes = lines([...report, null]);
      if (!sideband) return result(bytes);
      const framed = [];
      for (let offset = 0; offset < bytes.length; offset += 65515) {
        framed.push(Buffer.concat([Buffer.from([1]), bytes.subarray(offset, offset + 65515)]));
      }
      return result(lines([...framed, null]));
    };
    try {
      if (parsed.offset < body.length) objects.unpack(body.subarray(parsed.offset));
    } catch (error) {
      return reportResult([
        `unpack ${error.message}\n`,
        ...commands.map(([, , ref]) => `ng ${ref} unpacker error\n`),
      ]);
    }
    const report = ['unpack ok\n'];
    for (const [old, id, ref] of commands) {
      const current = repo.refs.get(ref) || ZERO;
      const reason = !validRef(ref) || !/^[0-9a-f]{40}$/.test(old) || !/^[0-9a-f]{40}$/.test(id)
        ? 'invalid ref command'
        : current !== old ? 'stale info'
        : id !== ZERO && !objects.get(id) ? 'missing object'
        : id !== ZERO && ref.startsWith('refs/heads/') && !objects.commit(id) ? 'not a commit'
        : old !== ZERO && id !== ZERO && (!ref.startsWith('refs/heads/') || !objects.ancestor(old, id))
          ? 'non-fast-forward' : null;
      if (reason) report.push(`ng ${ref} ${reason}\n`);
      else {
        if (id === ZERO) repo.refs.delete(ref);
        else repo.refs.set(ref, id);
        report.push(`ok ${ref}\n`);
      }
    }
    return reportResult(report);
  }

  if (text.includes('command=ls-refs')) {
    const prefixes = text.filter(line => line.startsWith('ref-prefix ')).map(line => line.slice(11));
    const matches = ref => !prefixes.length || prefixes.some(prefix => ref.startsWith(prefix));
    const answer = [], list = refs();
    if (head()) list.unshift(['HEAD', head()]);
    for (const [ref, id] of list) {
      if (!matches(ref)) continue;
      let extra = ref === 'HEAD' ? ` symref-target:refs/heads/${repo.default_branch}` : '';
      const object = objects.get(id);
      if (text.includes('peel') && object?.type === 'tag') {
        let target = id, visited = new Set();
        while (objects.get(target)?.type === 'tag' && !visited.has(target)) {
          visited.add(target);
          target = objects.get(target).data.toString().match(/^object (\w+)/)?.[1];
        }
        extra += ' peeled:' + target;
      }
      answer.push(`${id} ${ref}${extra}\n`);
    }
    if (!head() && text.includes('unborn') && matches('HEAD')) {
      answer.push(`unborn HEAD symref-target:refs/heads/${repo.default_branch}\n`);
    }
    return result(lines([...answer, null]));
  }

  const values = prefix => text.filter(line => line.startsWith(prefix + ' ')).map(line => line.split(' ')[1]);
  const wants = values('want'), haves = values('have'), shallow = values('shallow');
  const depth = Number(values('deepen')[0]) || Infinity;
  const known = new Set();
  for (const have of haves) {
    if (shallow.length) {
      known.add(have);
      const commit = objects.commit(have);
      if (commit) for (const id of objects.closure([commit.tree]).ids) known.add(id);
    } else for (const id of objects.closure([have]).ids) known.add(id);
  }
  // Traverse held shallow commits to extend ancestry, then exclude the client's held bytes.
  const { ids, boundary } = objects.closure(wants, depth);
  for (const id of known) ids.delete(id);
  const pack = objects.pack(ids), answer = [];
  const v2 = text.includes('command=fetch');
  if (boundary.length || shallow.length) {
    if (v2) answer.push('shallow-info\n');
    for (const id of boundary) answer.push(`shallow ${id}\n`);
    for (const id of shallow) if (!boundary.includes(id)) answer.push(`unshallow ${id}\n`);
    answer.push(v2 ? 1 : null);
  }
  answer.push(v2 ? 'packfile\n' : 'NAK\n');
  for (let offset = 0; offset < pack.length; offset += 65515) {
    answer.push(Buffer.concat([Buffer.from([1]), pack.subarray(offset, offset + 65515)]));
  }
  return result(lines([...answer, null]));
}
