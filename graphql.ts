import { fail } from './store.ts';

/** The executable subset used by gh and github-mcp-server, with a real token parser. */
function parse(source, variables) {
  if (typeof source !== 'string') throw Error('query must be a string');
  const tokens = source.match(/"(?:\\.|[^"\\])*"|#[^\r\n]*|\.\.\.|\$|[A-Za-z_][A-Za-z_0-9]*|-?\d+(?:\.\d+)?|[^\s,]/g)
    ?.filter(token => !token.startsWith('#')) || [];
  let position = 0;
  const vars = { ...variables }, fragments = new Map();
  const peek = () => tokens[position];
  const take = () => {
    if (position >= tokens.length) throw Error('Unexpected end of GraphQL document');
    return tokens[position++];
  };
  const expect = token => { if (take() !== token) throw Error(`Expected ${token}`); };
  const name = () => {
    const token = take();
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(token)) throw Error(`Expected name, got ${token}`);
    return token;
  };
  function value() {
    const token = take();
    if (token === '$') return vars[name()];
    if (token === '{') {
      const object = Object.create(null);
      while (peek() !== '}') { const key = name(); expect(':'); object[key] = value(); }
      expect('}'); return object;
    }
    if (token === '[') {
      const array = [];
      while (peek() !== ']') array.push(value());
      expect(']'); return array;
    }
    if (token.startsWith('"')) return JSON.parse(token);
    if (token === 'null') return null;
    if (token === 'true' || token === 'false') return token === 'true';
    if (/^-?\d/.test(token)) return Number(token);
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(token)) throw Error(`Invalid value ${token}`);
    return token;
  }
  function argumentsOf() {
    const args = Object.create(null);
    if (peek() !== '(') return args;
    expect('(');
    while (peek() !== ')') { const key = name(); expect(':'); args[key] = value(); }
    expect(')'); return args;
  }
  function selection() {
    expect('{');
    const fields = [];
    while (peek() !== '}') {
      if (peek() === '...') {
        take();
        const type = name();
        if (type === 'on') { name(); fields.push(...selection()); }
        else fields.push({ fragment: type });
        continue;
      }
      let field = name(), alias = field;
      if (peek() === ':') { take(); field = name(); }
      const args = argumentsOf();
      let include = true;
      while (peek() === '@') {
        take(); const directive = name(), args = argumentsOf();
        if (directive === 'skip' && args.if) include = false;
        if (directive === 'include' && !args.if) include = false;
      }
      const children = peek() === '{' ? selection() : [];
      if (include) fields.push({ name: field, alias, args, children });
    }
    expect('}'); return fields;
  }
  if (['query', 'mutation', 'subscription'].includes(peek())) {
    take();
    if (peek() !== '(' && peek() !== '{') name();
    if (peek() === '(') {
      take();
      while (peek() !== ')') {
        expect('$'); const key = name(); expect(':');
        while (peek() === '[' || peek() === ']' || peek() === '!' || /^[A-Za-z_]/.test(peek() || '')) take();
        if (peek() === '=') { take(); const fallback = value(); if (!(key in vars)) vars[key] = fallback; }
      }
      expect(')');
    }
  }
  const result = selection();
  while (position < tokens.length) {
    expect('fragment'); const key = name(); expect('on'); name(); fragments.set(key, selection());
  }
  const expand = (fields, stack = new Set()) => fields.flatMap(field => {
    if (field.fragment) {
      if (stack.has(field.fragment)) throw Error('Fragment cycle');
      if (!fragments.has(field.fragment)) throw Error(`Unknown fragment ${field.fragment}`);
      return expand(fragments.get(field.fragment), new Set([...stack, field.fragment]));
    }
    return [{ ...field, children: expand(field.children, stack) }];
  });
  return expand(result);
}

const FIELDS = {
  Issue: 'id number title state body',
  PullRequest: 'id number headRefName baseRefName mergeable state merged files',
  Repository: 'id databaseId name nameWithOwner owner defaultBranchRef viewerPermission hasIssuesEnabled issue issues pullRequests pullRequest',
};
const ENUMS = {
  SearchType: 'ISSUE REPOSITORY USER', IssueState: 'OPEN CLOSED', PullRequestState: 'OPEN CLOSED MERGED',
  MergeableState: 'MERGEABLE CONFLICTING UNKNOWN', OrderDirection: 'ASC DESC',
  IssueOrderField: 'CREATED_AT UPDATED_AT COMMENTS', PullRequestMergeMethod: 'MERGE SQUASH REBASE',
  RepositoryPermission: 'ADMIN MAINTAIN WRITE TRIAGE READ',
};
const wrap = (value, kind, repo) => value == null ? null : { value, kind, repo };

export function graphql(store, document) {
  if (Array.isArray(document)) return document.map(operation => graphql(store, operation));
  try {
    const ast = parse(document?.query, document?.variables || {});
    const findRepo = object => [...store.repos.values()].find(repo => repo === object ||
      [...repo.issues.values()].includes(object) || [...repo.pulls.values()].includes(object));

    function mutate(name, input) {
      let repo = store.nodes.get(input.repositoryId), object;
      if (name === 'createIssue') {
        if (!repo) fail(404, 'Repository not found');
        return { issue: wrap(store.issue(repo, input), 'Issue', repo) };
      }
      if (name === 'closeIssue') {
        object = store.nodes.get(input.issueId);
        if (!object || !findRepo(object)?.issues.has(object.number)) fail(404, 'Issue not found');
        object.state = 'closed';
        return { issue: wrap(object, 'Issue', findRepo(object)) };
      }
      if (name === 'createPullRequest') {
        if (!repo) fail(404, 'Repository not found');
        object = store.pull(repo, { ...input, head: input.headRefName, base: input.baseRefName });
        return { pullRequest: wrap(object, 'PullRequest', repo) };
      }
      if (name === 'mergePullRequest') {
        object = store.nodes.get(input.pullRequestId); repo = findRepo(object);
        if (!repo) fail(404, 'Pull request not found');
        store.merge(repo, object);
        return { pullRequest: wrap(object, 'PullRequest', repo) };
      }
      object = store.nodes.get(input.subjectId);
      if (!object?.commentList) fail(404, 'Subject not found');
      return { commentEdge: { node: wrap(store.comment(object, input), 'Comment') } };
    }

    function resolve(object, field) {
      const { name, args } = field;
      const { kind, value, repo } = object;
      if (name === '__typename') return kind;
      if (kind === 'Query') {
        if (name === 'viewer') return wrap(store.user(), 'User');
        if (name === 'repository') {
          let found;
          try { found = store.repo(args.owner, args.name); } catch { return null; }
          return wrap(found, 'Repository', found);
        }
        if (name === 'node') {
          const node = store.nodes.get(args.id);
          const type = node?.node_id ? Buffer.from(node.node_id, 'base64').toString().split(':')[0] : 'Node';
          return wrap(node, type, findRepo(node));
        }
        if (name === '__type') return wrap({ name: args.name }, '__Type');
        if (['createIssue', 'closeIssue', 'createPullRequest', 'mergePullRequest', 'addComment'].includes(name)) {
          return mutate(name, args.input || {});
        }
      }
      if (kind === '__Type') {
        if (name === 'fields') return (FIELDS[value.name] || '').split(' ').filter(Boolean).map(name => ({ name }));
        if (name === 'enumValues') return (ENUMS[value.name] || '').split(' ').filter(Boolean).map(name => ({ name }));
        return value[name];
      }
      if (kind === 'User' && name === 'login') return store.user().login;
      if (kind === 'Repository') {
        if (name === 'id') return value.node_id;
        if (name === 'databaseId') return value.id;
        if (name === 'nameWithOwner') return value.full_name;
        if (name === 'owner') return wrap(value.owner, 'User');
        if (name === 'defaultBranchRef') return { name: value.default_branch };
        if (name === 'viewerPermission') return 'ADMIN';
        if (name === 'hasIssuesEnabled') return value.has_issues;
        if (name === 'issue') return wrap(value.issues.get(args.number), 'Issue', value);
        if (name === 'pullRequest') return wrap(value.pulls.get(args.number), 'PullRequest', value);
        if (name === 'issues' || name === 'pullRequests') {
          const type = name === 'issues' ? 'Issue' : 'PullRequest';
          let list = [...value[name === 'issues' ? 'issues' : 'pulls'].values()];
          if (args.states) list = list.filter(item => args.states.includes(item.state.toUpperCase()));
          list.sort((a, b) => (a.number - b.number) * (args.orderBy?.direction === 'DESC' ? -1 : 1));
          const offset = args.after ? Number(Buffer.from(args.after, 'base64').toString()) : 0;
          const size = args.first ?? 30, part = list.slice(offset, offset + size), end = offset + part.length;
          return {
            nodes: part.map(item => wrap(item, type, value)),
            edges: part.map(item => ({ node: wrap(item, type, value) })), totalCount: list.length,
            pageInfo: { hasNextPage: end < list.length, endCursor: Buffer.from(String(end)).toString('base64') },
          };
        }
      }
      if (['Issue', 'PullRequest', 'Comment'].includes(kind)) {
        if (name === 'id') return value.node_id;
        if (name === 'state') return kind === 'PullRequest' && value.merged ? 'MERGED' : value.state.toUpperCase();
        if (kind === 'PullRequest') {
          if (name === 'headRefName') return value.head.ref;
          if (name === 'baseRefName') return value.base.ref;
          if (name === 'mergeable') return 'MERGEABLE';
          if (name === 'files') {
            const files = store.diff(repo, value);
            return { nodes: files.slice(0, args.first || 100).map(file => ({ path: file.filename })), totalCount: files.length };
          }
        }
      }
      if (value && Object.hasOwn(value, name)) return value[name];
      if (!kind && Object.hasOwn(object, name)) return object[name];
      throw Error(`Cannot query field "${name}" on type "${kind || 'Object'}".`);
    }

    function execute(object, selection) {
      if (object == null) return null;
      if (Array.isArray(object)) return object.map(item => execute(item, selection));
      const result = Object.create(null);
      for (const field of selection) {
        const value = resolve(object, field);
        result[field.alias] = field.children.length ? execute(value, field.children) : value;
      }
      return result;
    }
    return { data: execute({ kind: 'Query' }, ast) };
  } catch (error) {
    return { data: null, errors: [{ message: error.message }] };
  }
}
