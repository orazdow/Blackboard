import { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } from './config.local.js';

export { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO };

export const CHANNEL_PREFIX = '💬 ';
export const ARCHIVED_LABEL = 'blackboard:archived';
const REACTION_TYPES = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'];
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
  fetch: fetchImpl = globalThis.fetch, timeout = 20000, minWriteInterval = 1000,
} = {}) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let retryAt = 0;
  const cache = new Map();
  const inFlight = new Map();
  let queue = Promise.resolve();
  let lastWriteAt = 0;
  let viewerPromise;

  function request(path, options = {}) {
    const reading = !options.method || options.method === 'GET';
    if (reading && inFlight.has(path)) return inFlight.get(path);
    const result = queue.then(() => performRequest(path, options));
    queue = result.catch(() => {});
    if (reading) {
      inFlight.set(path, result);
      result.finally(() => inFlight.delete(path)).catch(() => {});
    }
    return result;
  }

  function nextPage(link) {
    const next = /<([^>]+)>;\s*rel="next"/.exec(link || '');
    if (!next) return null;
    const url = new URL(next[1]);
    if (url.origin !== 'https://api.github.com' || !url.pathname.toLowerCase().startsWith(new URL(base).pathname.toLowerCase() + '/')) {
      throw new GitHubError('GitHub returned an unexpected pagination URL.');
    }
    return url.href.slice(base.length);
  }

  async function performRequest(path, { method = 'GET', body, graphql = false, apiRoot = false } = {}) {
    if (!token || !owner || !repo) throw new GitHubError('Fill in GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in src/config.local.js.');
    if (Date.now() < retryAt) throw new GitHubError('GitHub rate limit reached. Waiting before another request.', { retryAt });
    const writing = method !== 'GET';
    const cached = writing ? null : cache.get(path);
    if (cached && Date.now() < cached.pollAfter) return cached.data;
    if (writing) {
      const wait = Math.max(0, lastWriteAt + minWriteInterval - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastWriteAt = Date.now();
      cache.clear();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(graphql ? 'https://api.github.com/graphql' : apiRoot ? `https://api.github.com${path}` : `${base}${path}`, {
        method,
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          ...(cached?.etag ? { 'If-None-Match': cached.etag }
            : cached?.lastModified ? { 'If-Modified-Since': cached.lastModified } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const pollInterval = response.headers.has('x-poll-interval')
        ? Number(response.headers.get('x-poll-interval') || 0) * 1000 : cached?.pollInterval || 0;
      const pollAfter = Date.now() + Math.max(0, pollInterval);
      if (response.status === 304 && cached) {
        cache.set(path, { ...cached, pollAfter, pollInterval });
        return cached.data;
      }
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || /rate limit/i.test(details.message || '')))) {
          const retryAfter = response.headers.get('retry-after');
          const retryDeadline = Number.isFinite(Number(retryAfter))
            ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter) || 0;
          retryAt = Math.max(Date.now() + 60000,
            Number(response.headers.get('x-ratelimit-reset') || 0) * 1000,
            retryDeadline);
        }
        throw new GitHubError(`GitHub ${response.status}: ${details.message || response.statusText}`, {
          status: response.status, uncertain: writing && response.status >= 500, retryAt,
        });
      }
      const result = response.status === 204 ? null : await response.json();
      if (graphql && result.errors?.length) {
        throw new GitHubError(result.errors.map((entry) => entry.message).join('; '), {
          uncertain: writing && result.errors.some((entry) => entry.type === 'INTERNAL'),
        });
      }
      if (!writing) cache.set(path, {
        data: result, etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        next: nextPage(response.headers.get('link')), pollAfter, pollInterval,
      });
      return result;
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
    const visited = new Set();
    let next = `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=1`;
    while (next) {
      const current = next;
      if (visited.has(current)) throw new GitHubError('GitHub returned a repeated pagination link.');
      visited.add(current);
      const items = await request(current);
      results.push(...items);
      next = cache.get(current)?.next || null;
    }
    return results;
  }

  const channel = (issue) => ({
    id: issue.number, name: issue.title.slice(CHANNEL_PREFIX.length),
    description: issue.body || '', state: issue.state, url: issue.html_url,
    parentId: null,
    milestoneId: issue.milestone?.number ?? null,
    archived: (issue.labels || []).some((label) => (typeof label === 'string' ? label : label.name) === ARCHIVED_LABEL),
  });
  const message = (comment) => ({
    id: comment.id, author: comment.user.login, ...decodeMessage(comment.body || ''),
    time: new Date(comment.created_at), url: comment.html_url,
    reactions: REACTION_TYPES.filter((type) => comment.reactions?.[type] > 0),
  });
  const issuePath = (id) => {
    if (!Number.isSafeInteger(id) || id < 1) throw new GitHubError('Invalid channel ID.');
    return `/issues/${id}`;
  };
  const reactionPath = (commentId) => {
    if (!Number.isSafeInteger(commentId) || commentId < 1) throw new GitHubError('Invalid comment ID.');
    return `/issues/comments/${commentId}/reactions`;
  };
  const reaction = (entry) => ({ id: entry.id, type: entry.content, author: entry.user.login });
  const isTopic = (issue) => !issue.pull_request && issue.title.startsWith(CHANNEL_PREFIX);
  const isLocal = (issue) => !issue.repository_url || issue.repository_url.toLowerCase() === base.toLowerCase();
  const subIssues = (id) => listAll(`${issuePath(id)}/sub_issues`);
  const milestonePath = (id) => {
    if (!Number.isSafeInteger(id) || id < 1) throw new GitHubError('Invalid milestone ID.');
    return `/milestones/${id}`;
  };
  const milestoneDate = (date) => {
    if (date === null || date === '') return null;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GitHubError('Invalid milestone due date.');
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new GitHubError('Invalid milestone due date.');
    return parsed.toISOString();
  };
  const milestone = (item) => {
    const open = item.open_issues || 0;
    const closed = item.closed_issues || 0;
    return {
      id: item.number, name: item.title, description: item.description || '', state: item.state,
      dueDate: item.due_on?.slice(0, 10) ?? null, url: item.html_url,
      open, closed, progress: open + closed ? Math.round(closed / (open + closed) * 100) : 0,
    };
  };
  async function topicTree(id) {
    const root = await request(issuePath(id));
    if (!isTopic(root)) throw new GitHubError('Only Blackboard topics can be changed.');
    const ordered = [];
    const visited = new Set();
    async function visit(issue, parentId) {
      if (visited.has(issue.id ?? issue.number)) return;
      visited.add(issue.id ?? issue.number);
      if (issue.sub_issues_summary?.total !== 0) {
        for (const child of await subIssues(issue.number)) {
          if (isLocal(child) && isTopic(child)) await visit(child, issue.number);
        }
      }
      ordered.push({ ...channel(issue), parentId });
    }
    await visit(root, undefined);
    return ordered;
  }

  const api = {
    async listMilestones({ includeClosed = false } = {}) {
      return (await listAll(`/milestones?state=${includeClosed ? 'all' : 'open'}&sort=due_on&direction=asc`)).map(milestone);
    },
    async createMilestone({ name, description = '', dueDate = null }) {
      if (!name.trim()) throw new GitHubError('A milestone name is required.');
      const dueOn = milestoneDate(dueDate);
      return milestone(await request('/milestones', { method: 'POST', body: {
        title: name.trim(), description, ...(dueOn ? { due_on: dueOn } : {}),
      } }));
    },
    async updateMilestone(id, { name, description, dueDate, state } = {}) {
      const path = milestonePath(id);
      const body = {};
      if (name !== undefined) {
        if (!name.trim()) throw new GitHubError('A milestone name is required.');
        body.title = name.trim();
      }
      if (description !== undefined) body.description = description;
      if (dueDate !== undefined) body.due_on = milestoneDate(dueDate);
      if (state !== undefined) {
        if (!['open', 'closed'].includes(state)) throw new GitHubError('Invalid milestone state.');
        body.state = state;
      }
      return milestone(await request(path, { method: 'PATCH', body }));
    },
    async setChannelMilestone(id, milestoneId) {
      const path = issuePath(id);
      if (milestoneId !== null) milestonePath(milestoneId);
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be assigned.');
      return channel(await request(path, { method: 'PATCH', body: { milestone: milestoneId } }));
    },
    async getViewer() {
      if (!viewerPromise) {
        viewerPromise = request('/user', { apiRoot: true }).then((user) => user.login)
          .catch((failure) => { viewerPromise = null; throw failure; });
      }
      return viewerPromise;
    },
    async listReactions(commentId) {
      return (await listAll(reactionPath(commentId))).map(reaction);
    },
    async addReaction(commentId, type) {
      if (!REACTION_TYPES.includes(type)) throw new GitHubError('Unsupported reaction.');
      return reaction(await request(reactionPath(commentId), { method: 'POST', body: { content: type } }));
    },
    async removeReaction(commentId, reactionId) {
      const path = reactionPath(commentId);
      if (!Number.isSafeInteger(reactionId) || reactionId < 1) throw new GitHubError('Invalid reaction ID.');
      await request(`${path}/${reactionId}`, { method: 'DELETE' });
    },
    async listChannels({ includeClosed = false, includeArchived = false, includeHierarchy = false } = {}) {
      const issues = await listAll(`/issues?state=${includeClosed ? 'all' : 'open'}&sort=created&direction=asc`);
      const topicIssues = issues.filter(isTopic);
      const channels = new Map(topicIssues.map((issue) => [issue.number, channel(issue)]));
      if (includeHierarchy) {
        for (const parent of topicIssues) {
          if (parent.sub_issues_summary?.total === 0) continue;
          for (const child of await subIssues(parent.number)) {
            if (isLocal(child) && channels.has(child.number)) channels.get(child.number).parentId = parent.number;
          }
        }
      }
      return [...channels.values()].filter((item) => includeArchived || !item.archived);
    },
    async createChannel({ name, topic = '', parentId = null }) {
      if (!name.trim()) throw new GitHubError('A topic name is required.');
      if (parentId !== null) {
        const parent = await request(issuePath(parentId));
        if (!isTopic(parent)) throw new GitHubError('The parent must be a Blackboard topic.');
      }
      const created = await request('/issues', { method: 'POST', body: { title: CHANNEL_PREFIX + name.trim(), body: topic } });
      if (parentId !== null) {
        try {
          await request(`${issuePath(parentId)}/sub_issues`, { method: 'POST', body: { sub_issue_id: created.id } });
        } catch (failure) {
          const error = new GitHubError(`Topic #${created.number} was created, but its parent link could not be confirmed. ${failure.message}`, { uncertain: failure.uncertain, retryAt: failure.retryAt });
          error.createdChannel = channel(created);
          throw error;
        }
      }
      return { ...channel(created), parentId };
    },
    async closeChannel(id) {
      return channel(await request(issuePath(id), { method: 'PATCH', body: { state: 'closed', state_reason: 'not_planned' } }));
    },
    async reopenChannel(id) {
      return channel(await request(issuePath(id), { method: 'PATCH', body: { state: 'open' } }));
    },
    async closeChannelTree(id, onChange = () => {}) {
      const tree = await topicTree(id);
      for (const item of tree) {
        try {
          if (item.state !== 'closed') await api.closeChannel(item.id);
        } catch (failure) { failure.affectedChannelId = item.id; throw failure; }
        onChange({ ...item, state: 'closed' });
      }
    },
    async archiveChannelTree(id, onChange = () => {}) {
      const tree = await topicTree(id);
      for (const item of tree) {
        try {
          if (!item.archived) await api.archiveChannel(item.id);
        } catch (failure) { failure.affectedChannelId = item.id; throw failure; }
        onChange({ ...item, archived: true });
      }
    },
    async archiveChannel(id) {
      const path = issuePath(id);
      const labelPath = `/labels/${encodeURIComponent(ARCHIVED_LABEL)}`;
      try {
        await request(labelPath);
      } catch (failure) {
        if (failure.status !== 404) throw failure;
        try {
          await request('/labels', { method: 'POST', body: {
            name: ARCHIVED_LABEL, color: '52657d', description: 'Archived Blackboard topic',
          } });
        } catch (creationFailure) {
          if (creationFailure.status !== 422) throw creationFailure;
          await request(labelPath); // Another client may have created it first.
        }
      }
      await request(`${path}/labels`, { method: 'POST', body: { labels: [ARCHIVED_LABEL] } });
      return { id, archived: true };
    },
    async deleteChannel(id) {
      const issue = await request(issuePath(id));
      if (issue.pull_request || !issue.title.startsWith(CHANNEL_PREFIX) || !issue.node_id) {
        throw new GitHubError('Only Blackboard topic issues can be deleted.');
      }
      const result = await request('', { graphql: true, method: 'POST', body: {
        query: 'mutation DeleteTopic($id: ID!) { deleteIssue(input: {issueId: $id}) { repository { id } } }',
        variables: { id: issue.node_id },
      } });
      if (!result.data?.deleteIssue?.repository) {
        throw new GitHubError('Deletion unconfirmed. Check GitHub before trying again.', { uncertain: true });
      }
      return { id, deleted: true };
    },
    async deleteChannelPreservingChildren(id, onChange = () => {}) {
      const parent = await request(issuePath(id));
      if (!isTopic(parent)) throw new GitHubError('Only Blackboard topics can be deleted.');
      const children = await subIssues(id);
      for (const child of children) {
        try {
          await request(`${issuePath(id)}/sub_issue`, { method: 'DELETE', body: { sub_issue_id: child.id } });
        } catch (failure) { failure.deletionNotAttempted = true; throw failure; }
        if (isLocal(child) && isTopic(child)) onChange({ ...channel(child), parentId: null });
      }
      return api.deleteChannel(id);
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
  return api;
}
