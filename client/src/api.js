import { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } from './config.local.js';

export { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO };

export const CHANNEL_PREFIX = '💬 ';
export const isConfigured = Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO);

const validSender = (sender) => typeof sender === 'string' && sender.length <= 64 && /^[a-z]/.test(sender) && !/[^a-z0-9_-]/.test(sender);

function encodeMessage(text, sender) {
  if (sender == null) return text;
  if (!validSender(sender)) throw new GitHubError('Sender must be 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter.');
  return `_@${sender}\n${text}`;
}

function decodeMessage(body) {
  const marker = /^_@([^\r\n]*)(?:\r?\n|$)/.exec(body);
  if (marker && validSender(marker[1])) {
    return { sender: marker[1], text: body.slice(marker[0].length) };
  }
  // Read older messages using hidden metadata for compatibility.
  const header = /^<!-- blackboard: (\{[^\r\n]*\}) -->\r?\n/.exec(body);
  const footer = /\r?\n<!-- blackboard: (\{[^\r\n]*\}) -->(?:\r?\n)?$/.exec(body);
  for (const match of [header, footer]) {
    if (!match) continue;
    try {
      const metadata = JSON.parse(match[1]);
      if (validSender(metadata.sender)) return {
        sender: metadata.sender,
        text: match === header ? body.slice(match[0].length) : body.slice(0, match.index).trimEnd(),
      };
    } catch { /* Preserve malformed headers as ordinary message text. */ }
  }
  return { sender: null, text: body };
}

export class GitHubError extends Error {
  constructor(message, { status = 0, uncertain = false, retryAt = 0 } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.uncertain = uncertain;
    this.retryAt = retryAt;
  }
}

// No browser/UI dependencies; fetch can be supplied by scripts or tests.
export function createGitHubClient({
  token = GITHUB_TOKEN, owner = GITHUB_OWNER, repo = GITHUB_REPO,
  fetch: fetchImpl = globalThis.fetch, timeout = 20000,
} = {}) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let retryAt = 0;

  async function request(path, { method = 'GET', body } = {}) {
    if (!token || !owner || !repo) throw new GitHubError('Fill in GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in src/config.local.js.');
    if (Date.now() < retryAt) throw new GitHubError('GitHub rate limit reached. Waiting before another request.', { retryAt });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const writing = method !== 'GET';
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
          retryAt = Math.max(Date.now() + 60000,
            Number(response.headers.get('x-ratelimit-reset') || 0) * 1000,
            Date.now() + Number(response.headers.get('retry-after') || 0) * 1000);
        }
        throw new GitHubError(`GitHub ${response.status}: ${details.message || response.statusText}`, {
          status: response.status, uncertain: writing && response.status >= 500, retryAt,
        });
      }
      return response.status === 204 ? null : await response.json();
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(writing
        ? 'Delivery unconfirmed. Check GitHub before trying again; the request may have succeeded.'
        : 'Could not reach GitHub. Check your connection.', { uncertain: writing });
    } finally {
      clearTimeout(timer);
    }
  }

  async function listAll(path) {
    const results = [];
    for (let page = 1; ; page += 1) {
      const items = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      results.push(...items);
      if (items.length < 100) return results;
    }
  }

  const channel = (issue) => ({
    id: issue.number, name: issue.title.slice(CHANNEL_PREFIX.length),
    description: issue.body || '', state: issue.state, url: issue.html_url,
  });
  const message = (comment) => ({
    id: comment.id, author: comment.user.login, ...decodeMessage(comment.body || ''),
    time: new Date(comment.created_at), url: comment.html_url,
  });
  const issuePath = (id) => {
    if (!Number.isSafeInteger(id) || id < 1) throw new GitHubError('Invalid channel ID.');
    return `/issues/${id}`;
  };

  return {
    async listChannels({ includeClosed = false } = {}) {
      const issues = await listAll(`/issues?state=${includeClosed ? 'all' : 'open'}&sort=created&direction=asc`);
      return issues.filter((issue) => !issue.pull_request && issue.title.startsWith(CHANNEL_PREFIX)).map(channel);
    },
    async createChannel({ name, topic = '' }) {
      if (!name.trim()) throw new GitHubError('A topic name is required.');
      return channel(await request('/issues', { method: 'POST', body: { title: CHANNEL_PREFIX + name.trim(), body: topic } }));
    },
    async closeChannel(id) {
      return channel(await request(issuePath(id), { method: 'PATCH', body: { state: 'closed', state_reason: 'not_planned' } }));
    },
    async reopenChannel(id) {
      return channel(await request(issuePath(id), { method: 'PATCH', body: { state: 'open' } }));
    },
    // Initial implementation returns a complete paginated snapshot. Polling
    // replaces the snapshot; comment IDs prevent duplicates. Cursor reads follow.
    async readMessages(id) {
      return (await listAll(`${issuePath(id)}/comments`)).map(message);
    },
    async sendMessage(id, text, { sender = null } = {}) {
      if (!text.trim()) throw new GitHubError('A message is required.');
      return message(await request(`${issuePath(id)}/comments`, { method: 'POST', body: { body: encodeMessage(text, sender) } }));
    },
  };
}
