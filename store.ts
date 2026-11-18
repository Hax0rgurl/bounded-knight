import { Objects } from './objects.ts';
import { validRef } from './git.ts';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
const response = (body, status = 200, headers = {}) => ({ status, body, headers });
const notFound = () => fail(404, 'Not Found');
const EMPTY_QUERY = new URLSearchParams();

export class Store {
  objects = new Objects();
  repos = new Map();
  nodes = new Map();
  issueSnapshots = new Map();
  issueSnapshotBytes = 0;
  next = 1;
  login = process.env.FORGE_LOGIN || null;
  now = process.env.MAKEFUN_TRIAL_NOW || '2026-01-01T00:00:00.000Z';

  // The opaque trial token has no identity claims. Bind its single tenant on the
  // first authenticated owner-qualified request, unless FORGE_LOGIN configured it.
  bind(owner) {
    if (this.login) return;
    this.login = owner;
    for (const repo of this.repos.values()) {
      repo.owner.login = owner;
      repo.full_name = owner + '/' + repo.name;
    }
  }

  user() { return { login: this.login || 'relay', id: 1, type: 'User' }; }

  identify(object, type) {
    object.id = this.next++;
    object.node_id = Buffer.from(`${type}:${object.id}`).toString('base64');
    this.nodes.set(object.node_id, object);
    return object;
  }

  repo(owner, name) {
    this.bind(owner);
    if (owner !== this.login) notFound();
    return this.repos.get(name) || notFound();
  }

  create(input) {
    if (typeof input.name !== 'string' || !/^[\w.-]+$/.test(input.name) || ['.', '..'].includes(input.name)) {
      fail(422, 'Invalid repository name');
    }
    if (this.repos.has(input.name)) fail(422, 'Repository already exists');
    const repo = this.identify({
      name: input.name, full_name: `${this.user().login}/${input.name}`, owner: this.user(),
      private: !!input.private, description: input.description || '',
      default_branch: input.default_branch || 'main', has_issues: true,
      created_at: this.now, updated_at: this.now,
    }, 'Repository');
    Object.defineProperties(repo, {
      refs: { value: new Map() }, issues: { value: new Map() }, pulls: { value: new Map() },
      labels: { value: new Map() }, serial: { value: { n: 0 } },
    });
    this.repos.set(repo.name, repo);
    if (input.auto_init) {
      const files = new Map([['README.md', { sha: this.objects.put('blob', `# ${repo.name}\n`) }]]);
      repo.refs.set('refs/heads/' + repo.default_branch, this.objects.makeCommit(files, [], 'Initial commit'));
    }
    return repo;
  }

  tip(repo, ref) {
    return repo.refs.get(ref) || repo.refs.get('refs/heads/' + (ref || repo.default_branch)) ||
      repo.refs.get('refs/tags/' + ref) || (this.objects.get(ref) ? ref : null);
  }

  issue(repo, input) {
    if (typeof input.title !== 'string' || !input.title) fail(422, 'title is required');
    if (input.labels && !Array.isArray(input.labels)) fail(422, 'labels must be an array');
    const labels = (input.labels || []).map(name => {
      const label = repo.labels.get(typeof name === 'string' ? name : name?.name);
      if (!label) fail(422, 'Label does not exist');
      return label;
    });
    const issue = this.identify({
      number: ++repo.serial.n, title: input.title, body: input.body || '', state: 'open',
      labels, user: this.user(), created_at: this.now, updated_at: this.now, comments: 0,
    }, 'Issue');
    Object.defineProperty(issue, 'commentList', { value: [] });
    repo.issues.set(issue.number, issue);
    return issue;
  }

  comment(issue, input) {
    if (typeof input.body !== 'string') fail(422, 'body is required');
    const comment = this.identify({
      body: input.body, user: this.user(), created_at: this.now, updated_at: this.now,
    }, 'Comment');
    issue.commentList.push(comment); issue.comments++;
    this.invalidateIssue(issue);
    return comment;
  }

  updateIssue(issue, input) {
    if (input.state && !['open', 'closed'].includes(input.state)) fail(422, 'Invalid issue state');
    for (const key of ['state', 'title', 'body']) if (key in input) issue[key] = input[key];
    issue.updated_at = this.now;
    this.invalidateIssue(issue);
    return issue;
  }

  invalidateIssue(issue) {
    const old = this.issueSnapshots.get(issue);
    if (old) {
      this.issueSnapshotBytes -= old.length;
      this.issueSnapshots.delete(issue);
    }
  }

  readIssue(issue) {
    let serialized = this.issueSnapshots.get(issue);
    if (!serialized) {
      serialized = Buffer.from(JSON.stringify(issue));
      if (serialized.length <= 64 * 1024) {
        while (this.issueSnapshots.size >= 1024 || this.issueSnapshotBytes + serialized.length > 1024 * 1024) {
          this.invalidateIssue(this.issueSnapshots.keys().next().value);
        }
        this.issueSnapshots.set(issue, serialized);
        this.issueSnapshotBytes += serialized.length;
      }
    }
    return { ...response(issue), serialized };
  }

  pull(repo, input) {
    const head = input.head?.split(':').at(-1), base = input.base || repo.default_branch;
    const headSha = this.tip(repo, head), baseSha = this.tip(repo, base);
    if (!head || !this.objects.commit(headSha) || !this.objects.commit(baseSha) || !input.title) {
      fail(422, 'Invalid head, base or title');
    }
    const pull = this.identify({
      number: ++repo.serial.n, title: input.title, body: input.body || '', state: 'open', merged: false,
      head: { ref: head, sha: headSha }, base: { ref: base, sha: baseSha }, user: this.user(),
      created_at: this.now, updated_at: this.now, merge_commit_sha: null, merged_at: null,
    }, 'PullRequest');
    Object.defineProperty(pull, 'mergeBase', { value: this.objects.mergeBase(headSha, baseSha) });
    repo.pulls.set(pull.number, pull);
    return pull;
  }

  diff(repo, pull) {
    const before = this.objects.files(pull.mergeBase || pull.base.sha);
    const after = this.objects.files(this.tip(repo, pull.head.ref));
    const files = [];
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(path)?.sha === after.get(path)?.sha) continue;
      const a = this.objects.get(before.get(path)?.sha)?.data.toString() || '';
      const b = this.objects.get(after.get(path)?.sha)?.data.toString() || '';
      const count = text => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
      const additions = count(b), deletions = count(a);
      files.push({
        filename: path, status: !before.has(path) ? 'added' : !after.has(path) ? 'removed' : 'modified',
        additions, deletions, changes: additions + deletions,
        patch: `@@ -1,${deletions} +1,${additions} @@\n` +
          a.split('\n').map(line => '-' + line).join('\n') + '\n' +
          b.split('\n').map(line => '+' + line).join('\n'),
      });
    }
    return files;
  }

  merge(repo, pull) {
    if (!pull) notFound();
    if (pull.merged) return { sha: pull.merge_commit_sha, merged: true, message: 'Already merged' };
    const old = this.tip(repo, pull.base.ref), head = this.tip(repo, pull.head.ref);
    const base = this.objects.files(pull.mergeBase || pull.base.sha);
    const current = this.objects.files(old), incoming = this.objects.files(head);
    for (const path of new Set([...base.keys(), ...incoming.keys()])) {
      const a = base.get(path)?.sha, b = incoming.get(path)?.sha, c = current.get(path)?.sha;
      if (a === b) continue;
      if (c !== a && c !== b) fail(405, 'Pull request is not mergeable');
      if (incoming.has(path)) current.set(path, incoming.get(path));
      else current.delete(path);
    }
    const sha = this.objects.makeCommit(current, [old], pull.title);
    repo.refs.set('refs/heads/' + pull.base.ref, sha);
    Object.assign(pull, { merged: true, state: 'closed', merged_at: this.now, merge_commit_sha: sha });
    return { sha, merged: true, message: 'Pull Request successfully merged' };
  }

  content(path, entry) {
    const data = this.objects.get(entry.sha)?.data || Buffer.alloc(0);
    return {
      name: path.split('/').at(-1), path, type: 'file', sha: entry.sha,
      size: data.length, encoding: 'base64', content: data.toString('base64'),
    };
  }

  rest(method, path, body = {}, query = EMPTY_QUERY) {
    let parts;
    try { parts = path.split('/').filter(Boolean).map(decodeURIComponent); }
    catch { fail(400, 'Invalid URL encoding'); }
    if (parts[0] === 'api' && parts[1] === 'v3') parts = parts.slice(2);
    const page = list => {
      const size = Math.min(100, Math.max(1, Number(query.get('per_page')) || 30));
      const number = Math.max(1, Number(query.get('page')) || 1), headers = {};
      if (number * size < list.length) {
        const next = new URLSearchParams(query);
        next.set('page', String(number + 1)); next.set('per_page', String(size));
        headers.link = `<${path}?${next}>; rel="next"`;
      }
      return response(list.slice((number - 1) * size, number * size), 200, headers);
    };
    if (!parts.length && method === 'GET') {
      return response({ current_user_url: '/api/v3/user' }, 200, { 'x-oauth-scopes': 'repo, read:org' });
    }
    if (parts.length === 1 && method === 'GET') {
      if (parts[0] === 'meta') return response({ installed_version: 'relay-1.0.0' });
      if (parts[0] === 'user') return response(this.user());
    }
    if (parts[0] === 'user' && parts[1] === 'repos' && parts.length === 2) {
      if (method === 'POST') return response(this.create(body), 201);
      if (method === 'GET') return page([...this.repos.values()]);
    }
    if (parts[0] !== 'repos' || parts.length < 3) notFound();
    const repo = this.repo(parts[1], parts[2]), tail = parts.slice(3), number = Number(tail[1]);
    if (!tail.length) {
      if (method === 'GET') return response(repo);
      if (method === 'PATCH') {
        for (const key of ['description', 'default_branch', 'private', 'has_issues']) if (key in body) repo[key] = body[key];
        return response(repo);
      }
      if (method === 'DELETE') {
        this.repos.delete(repo.name);
        this.nodes.delete(repo.node_id);
        for (const issue of repo.issues.values()) {
          this.invalidateIssue(issue);
          this.nodes.delete(issue.node_id);
          for (const comment of issue.commentList) this.nodes.delete(comment.node_id);
        }
        for (const pull of repo.pulls.values()) this.nodes.delete(pull.node_id);
        return response(null, 204);
      }
    }
    if (tail[0] === 'branches' && method === 'GET') {
      const branches = [...repo.refs].filter(([ref]) => ref.startsWith('refs/heads/'))
        .map(([ref, sha]) => ({ name: ref.slice(11), commit: { sha }, protected: false }));
      return response(tail.length > 1
        ? branches.find(branch => branch.name === tail.slice(1).join('/')) || notFound() : branches);
    }
    if (tail[0] === 'git' && ['refs', 'ref'].includes(tail[1])) {
      if (method === 'POST' && tail.length === 2) {
        if (!validRef(body.ref) || !this.objects.get(body.sha)) fail(422, 'Invalid reference');
        if (repo.refs.has(body.ref)) fail(422, 'Reference already exists');
        repo.refs.set(body.ref, body.sha);
        return response({ ref: body.ref, object: { sha: body.sha, type: this.objects.get(body.sha).type } }, 201);
      }
      let ref = tail.slice(2).join('/');
      if (!ref.startsWith('refs/')) ref = 'refs/' + ref;
      let sha = repo.refs.get(ref);
      if (!sha) notFound();
      if (method === 'DELETE') { repo.refs.delete(ref); return response(null, 204); }
      if (method === 'PATCH') {
        if (!this.objects.get(body.sha)) fail(422, 'Unknown object');
        if (!body.force && !this.objects.ancestor(sha, body.sha)) fail(422, 'Not a fast forward');
        repo.refs.set(ref, body.sha); sha = body.sha;
      }
      if (method === 'GET' || method === 'PATCH') return response({ ref, object: { sha, type: this.objects.get(sha).type } });
    }
    if (tail[0] === 'contents') return this.contents(method, repo, tail.slice(1).join('/'), body, query);
    if (tail[0] === 'commits' && tail.length <= 2 && method === 'GET') {
      const tip = this.tip(repo, query.get('sha') || tail[1] || repo.default_branch);
      const commits = [], seen = new Set(), todo = tip ? [tip] : [];
      for (let cursor = 0; cursor < todo.length; cursor++) {
        const sha = todo[cursor];
        if (seen.has(sha)) continue;
        seen.add(sha);
        const commit = this.objects.commit(sha);
        if (!commit) continue;
        commits.push({ sha, commit: { message: commit.message.replace(/\n$/, ''), tree: { sha: commit.tree } }, parents: commit.parents.map(sha => ({ sha })) });
        todo.push(...commit.parents);
      }
      return tail[1] ? response(commits[0] || notFound()) : page(commits);
    }
    if (tail[0] === 'labels' && tail.length === 1) {
      if (method === 'POST') {
        if (!body.name) fail(422, 'name is required');
        const label = { id: this.next++, name: body.name, color: body.color || 'ededed', description: body.description || '' };
        repo.labels.set(label.name, label);
        return response(label, 201);
      }
      if (method === 'GET') return response([...repo.labels.values()]);
    }
    if (tail[0] === 'issues') {
      if (tail.length === 1) {
        if (method === 'POST') return response(this.issue(repo, body), 201);
        if (method === 'GET') {
          const list = [...repo.issues.values()].filter(issue => query.get('state') === 'all' || issue.state === (query.get('state') || 'open'));
          list.sort((a, b) => (a.number - b.number) * (query.get('direction') === 'asc' ? 1 : -1));
          return page(list);
        }
      }
      const issue = repo.issues.get(number);
      if (!issue) notFound();
      if (tail.length === 3 && tail[2] === 'comments') {
        if (method === 'POST') return response(this.comment(issue, body), 201);
        if (method === 'GET') return page(issue.commentList);
      }
      if (tail.length === 2) {
        if (method === 'PATCH') return response(this.updateIssue(issue, body));
        if (method === 'GET') return this.readIssue(issue);
      }
    }
    if (tail[0] === 'pulls') {
      if (tail.length === 1) {
        if (method === 'POST') return response(this.pull(repo, body), 201);
        if (method === 'GET') return page([...repo.pulls.values()].filter(pull => query.get('state') === 'all' || pull.state === (query.get('state') || 'open')));
      }
      const pull = repo.pulls.get(number);
      if (!pull) notFound();
      if (tail.length === 3 && tail[2] === 'files' && method === 'GET') return response(this.diff(repo, pull));
      if (tail.length === 3 && tail[2] === 'merge' && method === 'PUT') return response(this.merge(repo, pull));
      if (tail.length === 2) {
        if (method === 'PATCH') for (const key of ['title', 'body', 'state']) if (key in body) pull[key] = body[key];
        if (method === 'GET' || method === 'PATCH') return response(pull);
      }
    }
    notFound();
  }

  contents(method, repo, path, body, query) {
    const branch = body.branch || query.get('ref') || repo.default_branch;
    const tip = this.tip(repo, branch), files = this.objects.files(tip), old = files.get(path);
    if (method === 'GET') {
      if (!tip) notFound();
      if (old) return response(this.content(path, old));
      const prefix = path ? path.replace(/\/$/, '') + '/' : '', entries = new Map();
      for (const [name, entry] of files) {
        if (!name.startsWith(prefix)) continue;
        const suffix = name.slice(prefix.length), base = suffix.split('/')[0];
        if (suffix.includes('/')) entries.set(base, { name: base, path: prefix + base, type: 'dir', sha: this.objects.commit(tip)?.tree, size: 0 });
        else entries.set(base, this.content(name, entry));
      }
      if (!entries.size) notFound();
      return response([...entries.values()]);
    }
    if (method !== 'PUT' && method !== 'DELETE') notFound();
    if (method === 'DELETE' && !old) notFound();
    if (old && body.sha !== old.sha || !old && body.sha) fail(409, 'SHA does not match');
    if (!path || path.includes('\0') || path.split('/').some(part => !part || part === '..' || part === '.')) fail(422, 'Invalid path');
    if (method === 'DELETE') files.delete(path);
    else {
      if (typeof body.content !== 'string') fail(422, 'content is required');
      if ([...files.keys()].some(name => name !== path && (name.startsWith(path + '/') || path.startsWith(name + '/')))) fail(422, 'File and directory paths overlap');
      files.set(path, { sha: this.objects.put('blob', Buffer.from(body.content, 'base64')), mode: old?.mode || '100644' });
    }
    if (!validRef('refs/heads/' + branch)) fail(422, 'Invalid branch');
    const sha = this.objects.makeCommit(files, tip ? [tip] : [], body.message || 'Update ' + path);
    repo.refs.set('refs/heads/' + branch, sha);
    return response({ content: method === 'DELETE' ? null : this.content(path, files.get(path)), commit: { sha } }, method === 'DELETE' || old ? 200 : 201);
  }
}
