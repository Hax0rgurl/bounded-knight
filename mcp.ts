export const tools = [
  ['create_repo', 'Create a repository in the shared forge.', ['name'],
    { name: 'string', description: 'string', private: 'boolean' }],
  ['get_repo', 'Read a repository.', ['owner', 'repo'], { owner: 'string', repo: 'string' }],
  ['create_issue', 'Create an issue.', ['owner', 'repo', 'title'],
    { owner: 'string', repo: 'string', title: 'string', body: 'string' }],
  ['list_issues', 'List repository issues.', ['owner', 'repo'],
    { owner: 'string', repo: 'string', state: 'string' }],
  ['create_pull_request', 'Open a pull request between existing branches.', ['owner', 'repo', 'title', 'head', 'base'],
    { owner: 'string', repo: 'string', title: 'string', body: 'string', head: 'string', base: 'string' }],
  ['merge_pull_request', 'Squash and merge a pull request.', ['owner', 'repo', 'pull_number'],
    { owner: 'string', repo: 'string', pull_number: 'number' }],
].map(([name, description, required, properties]) => ({
  name, description,
  inputSchema: {
    type: 'object', required,
    properties: Object.fromEntries(Object.entries(properties).map(([key, type]) => [key, { type }])),
  },
}));

export function mcp(store, request) {
  const error = (code, message) => ({ jsonrpc: '2.0', id: request?.id ?? null, error: { code, message } });
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return error(-32600, 'Invalid Request');
  }
  let result;
  if (request.method === 'server/discover' || request.method === 'initialize') {
    const legacy = request.method === 'initialize' && request.params?.protocolVersion <= '2025-11-25';
    result = {
      protocolVersion: legacy ? request.params.protocolVersion : '2026-07-28',
      supportedVersions: ['2026-07-28', '2025-11-25'],
      serverInfo: { name: 'Relay Git Forge', version: '1.0.0' },
      capabilities: { tools: { listChanged: false } },
    };
  } else if (request.method === 'notifications/initialized') return null;
  else if (request.method === 'ping') result = {};
  else if (request.method === 'tools/list') result = { tools };
  else if (request.method === 'tools/call') {
    const tool = tools.find(tool => tool.name === request.params?.name);
    if (!tool) return error(-32601, 'Unknown tool');
    const args = request.params.arguments || {};
    if (typeof args !== 'object' || Array.isArray(args) ||
        tool.inputSchema.required.some(key => args[key] === undefined || args[key] === '')) {
      return error(-32602, 'Missing required argument');
    }
    for (const [key, value] of Object.entries(args)) {
      const property = tool.inputSchema.properties[key];
      if (property && typeof value !== property.type) return error(-32602, `Invalid type for ${key}`);
    }
    try {
      let value;
      if (tool.name === 'create_repo') value = store.create(args);
      else {
        const repo = store.repo(args.owner, args.repo);
        if (tool.name === 'get_repo') value = repo;
        if (tool.name === 'create_issue') value = store.issue(repo, args);
        if (tool.name === 'list_issues') value = [...repo.issues.values()]
          .filter(issue => args.state === 'all' || issue.state === (args.state || 'open'));
        if (tool.name === 'create_pull_request') value = store.pull(repo, args);
        if (tool.name === 'merge_pull_request') value = store.merge(repo, repo.pulls.get(Number(args.pull_number)));
      }
      result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false };
    } catch (error) {
      result = { content: [{ type: 'text', text: error.message }], isError: true };
    }
  } else return error(-32601, 'Method not found');
  return { jsonrpc: '2.0', id: request.id ?? null, result };
}
