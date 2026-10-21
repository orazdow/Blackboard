import { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } from './config.local.js';
import * as localConfig from './config.local.js';

export { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO };

export const CHANNEL_PREFIX = '💬 ';
export const ARCHIVED_LABEL = 'blackboard:archived';
const REACTION_TYPES = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'];
const REACTION_ENUMS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'CONFUSED', 'HEART', 'HOORAY', 'ROCKET', 'EYES'];
export const isDiscussionId = (id) => typeof id === 'string' && /^discussion:[A-Za-z0-9_=-]{1,256}$/.test(id);
export const isConfigured = Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO);
export const isProjectConfigured = Boolean(localConfig.GITHUB_PROJECT_TOKEN);

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
  projectToken = localConfig.GITHUB_PROJECT_TOKEN || token,
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
    const reading = options.graphqlRead || !options.method || options.method === 'GET';
    const key = options.graphqlRead ? `graphql:${JSON.stringify(options.body)}` : path;
    if (reading && inFlight.has(key)) return inFlight.get(key);
    const result = queue.then(() => performRequest(path, { ...options, cacheKey: key }));
    queue = result.catch(() => {});
    if (reading) {
      inFlight.set(key, result);
      result.finally(() => inFlight.delete(key)).catch(() => {});
    }
    return result;
  }

  function nextPage(link, path) {
    const next = /<([^>]+)>;\s*rel="next"/.exec(link || '');
    if (!next) return null;
    const url = new URL(next[1]);
    const repositoryPath = new URL(base).pathname;
    const namedRepository = url.pathname.toLowerCase().startsWith(repositoryPath.toLowerCase() + '/');
    const numericRepository = /^\/repositories\/\d+(\/.*)$/.exec(url.pathname);
    const resourcePath = namedRepository ? url.pathname.slice(repositoryPath.length) : numericRepository?.[1];
    if (url.origin !== 'https://api.github.com' || url.username || url.password || !resourcePath || resourcePath !== path.split('?')[0]) {
      throw new GitHubError('GitHub returned an unexpected pagination URL.');
    }
    // GitHub can use /repositories/<database ID>/... in Link headers. Keep
    // only the same endpoint and its query, so every page still goes through
    // our configured owner/repo rather than following an arbitrary repo URL.
    return `${resourcePath}${url.search}`;
  }

  async function performRequest(path, { method = 'GET', body, graphql = false, graphqlRead = false, apiRoot = false, cacheKey = path, authToken = token } = {}) {
    if (!authToken || !owner || !repo) throw new GitHubError('Fill in the token, owner, and repository in src/config.local.js.');
    if (Date.now() < retryAt) throw new GitHubError('GitHub rate limit reached. Waiting before another request.', { retryAt });
    const writing = method !== 'GET' && !graphqlRead;
    const cached = writing ? null : cache.get(cacheKey);
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
          Authorization: `Bearer ${authToken}`,
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
        cache.set(cacheKey, { ...cached, pollAfter, pollInterval });
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
        if (result.errors.some((entry) => entry.type === 'RATE_LIMITED' || /rate limit/i.test(entry.message))) retryAt = Date.now() + 60000;
        throw new GitHubError(result.errors.map((entry) => entry.message).join('; '), {
          status: result.errors.some((entry) => entry.type === 'FORBIDDEN') ? 403 : 0, retryAt,
          uncertain: writing && result.errors.some((entry) => entry.type === 'INTERNAL'),
        });
      }
      if (!writing) cache.set(cacheKey, {
        data: result, etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        next: nextPage(response.headers.get('link'), path), pollAfter, pollInterval,
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

  async function projectQuery(query, variables, mutation = false) {
    return request('', { method: 'POST', graphql: true, graphqlRead: !mutation, authToken: projectToken, body: { query, variables } });
  }
  const discussionQuery = (query, variables, mutation = false) => request('', {
    method: 'POST', graphql: true, graphqlRead: !mutation, body: { query, variables },
  });
  const discussionNode = (id) => {
    if (!isDiscussionId(id)) throw new GitHubError('Invalid discussion identifier.');
    return id.slice('discussion:'.length);
  };
  const discussionFields = 'id number title body closed url category { id name } labels(first:100) { nodes { name color description } pageInfo { hasNextPage endCursor } }';
  const commentFields = 'id body createdAt url author { login } reactionGroups { content users { totalCount } }';
  const discussionMessage = (entry, replyTo = null) => ({
    id: `dc:${entry.id}`, author: entry.author?.login || 'Deleted user', ...decodeMessage(entry.body || ''),
    time: new Date(entry.createdAt), url: entry.url, replyTo,
    reactions: (entry.reactionGroups || []).filter((group) => group.users.totalCount > 0).map((group) => REACTION_TYPES[REACTION_ENUMS.indexOf(group.content)]).filter(Boolean),
  });
  const chronological = (a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id));
  async function discussionLabels(entry) {
    const labels = [...(entry.labels?.nodes || [])];
    let after = null;
    let connection = entry.labels;
    const visited = new Set();
    while (connection && (after = nextCursor(connection, visited))) {
      const result = await discussionQuery(`query BlackboardDiscussionLabels($id:ID!,$after:String!) {
        node(id:$id) { ... on Discussion { labels(first:100,after:$after) { nodes { name color description } pageInfo { hasNextPage endCursor } } } }
      }`, { id: entry.id, after });
      connection = result.data?.node?.labels;
      if (!connection) throw new GitHubError('Could not read discussion tags.');
      labels.push(...connection.nodes);
    }
    return labels;
  }
  async function discussion(entry) {
    if (!entry?.id) throw new GitHubError('Discussion is unavailable.');
    const labels = await discussionLabels(entry);
    return { id: `discussion:${entry.id}`, number: entry.number, kind: 'discussion', name: entry.title.startsWith(CHANNEL_PREFIX) ? entry.title.slice(CHANNEL_PREFIX.length) : entry.title,
      description: entry.body || '', state: entry.closed ? 'closed' : 'open', url: entry.url,
      parentId: null, milestoneId: null, tags: topicTags(labels), category: entry.category,
      archived: labels.some((label) => label.name === ARCHIVED_LABEL) };
  }
  async function ensureLabel(name) {
    const path = `/labels/${encodeURIComponent(name)}`;
    try { return await request(path); }
    catch (failure) {
      if (failure.status !== 404) throw failure;
      try { return await request('/labels', { method: 'POST', body: { name, color: '52769b' } }); }
      catch (creationFailure) {
        if (creationFailure.status !== 422) throw creationFailure;
        return request(path);
      }
    }
  }
  async function changeDiscussionLabel(id, name, add) {
    let label;
    try { label = add ? await ensureLabel(name) : await request(`/labels/${encodeURIComponent(name)}`); }
    catch (failure) { failure.tagNotApplied = true; throw failure; }
    if (!label.node_id) throw new GitHubError('Could not identify the tag.');
    const operation = add ? 'addLabelsToLabelable' : 'removeLabelsFromLabelable';
    const result = await discussionQuery(`mutation BlackboardDiscussionTag($id:ID!,$labels:[ID!]!) {
      ${operation}(input:{labelableId:$id,labelIds:$labels}) { labelable { id } }
    }`, { id: discussionNode(id), labels: [label.node_id] }, true);
    if (result.data?.[operation]?.labelable?.id !== discussionNode(id)) throw new GitHubError('Tag change unconfirmed. Refresh before trying again.', { uncertain: true });
    // Do not repeat a confirmed write if the following read fails.
    try { return (await api.readDiscussion(id)).tags; }
    catch (failure) { failure.uncertain = true; throw failure; }
  }
  async function discussionState(id, closed) {
    const operation = closed ? 'closeDiscussion' : 'reopenDiscussion';
    const result = await discussionQuery(`mutation BlackboardDiscussionState($id:ID!) {
      ${operation}(input:{discussionId:$id${closed ? ',reason:RESOLVED' : ''}}) { discussion { ${discussionFields} } }
    }`, { id: discussionNode(id) }, true);
    const entry = result.data?.[operation]?.discussion;
    if (entry?.id !== discussionNode(id)) throw new GitHubError('Discussion change unconfirmed. Refresh before trying again.', { uncertain: true });
    return discussion(entry);
  }
  function nodeId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_=-]{1,256}$/.test(id)) throw new GitHubError('Invalid project identifier.');
    return id;
  }
  function nextCursor(connection, visited) {
    if (!connection.pageInfo?.hasNextPage) return null;
    const cursor = connection.pageInfo.endCursor;
    if (!cursor || visited.has(cursor)) throw new GitHubError('GitHub returned a repeated project pagination cursor.');
    visited.add(cursor);
    return cursor;
  }

  const tag = (label) => ({
    name: typeof label === 'string' ? label : label.name,
    color: typeof label !== 'string' && /^[0-9a-f]{6}$/i.test(label.color) ? label.color : '52769b',
    description: typeof label === 'string' ? '' : label.description || '',
  });
  const topicTags = (labels) => labels.map(tag).filter((item) => item.name.toLowerCase() !== ARCHIVED_LABEL.toLowerCase());
  const tagName = (name) => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 50 || /[\x00-\x1f\x7f]/.test(name)) throw new GitHubError('Tag names must contain 1–50 characters.');
    const trimmed = name.trim();
    if (trimmed.toLowerCase() === ARCHIVED_LABEL.toLowerCase()) throw new GitHubError('Use Archive to archive a topic.');
    return trimmed;
  };
  const channel = (issue) => ({
    id: issue.number, name: issue.title.slice(CHANNEL_PREFIX.length),
    description: issue.body || '', state: issue.state, url: issue.html_url,
    parentId: null,
    milestoneId: issue.milestone?.number ?? null,
    tags: topicTags(issue.labels || []),
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
    async checkRepository() {
      const repository = await request('');
      if (!repository?.owner?.login || !repository.name) throw new GitHubError('Could not identify this repository.');
      if (repository.has_issues === false) throw new GitHubError('Enable Issues in this repository’s GitHub settings before connecting Blackboard.');
      // Repository visibility alone does not establish access to its Issues API.
      await request('/issues?state=open&per_page=1');
      return { owner: repository.owner.login, repo: repository.name };
    },
    async listDiscussions({ includeClosed = false, includeArchived = false } = {}) {
      const entries = [], visited = new Set();
      let after = null;
      do {
        const result = await discussionQuery(`query BlackboardDiscussions($owner:String!,$repo:String!,$after:String) {
          repository(owner:$owner,name:$repo) { hasDiscussionsEnabled discussions(first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}) {
            nodes { ${discussionFields} } pageInfo { hasNextPage endCursor }
          } }
        }`, { owner, repo, after });
        const repository = result.data?.repository;
        if (repository?.hasDiscussionsEnabled === false) return [];
        if (!repository?.discussions) throw new GitHubError('Could not read discussions. Check the token’s Discussions permission.');
        for (const entry of repository.discussions.nodes.filter(Boolean)) entries.push(await discussion(entry));
        after = nextCursor(repository.discussions, visited);
      } while (after);
      return entries.filter((item) => (includeClosed || item.state === 'open') && (includeArchived || !item.archived));
    },
    async readDiscussion(id) {
      const result = await discussionQuery(`query BlackboardDiscussion($id:ID!) { node(id:$id) { ... on Discussion { ${discussionFields} } } }`, { id: discussionNode(id) });
      return discussion(result.data?.node);
    },
    async createDiscussion({ name, topic = '' }) {
      if (!name.trim()) throw new GitHubError('A topic name is required.');
      let repositoryId, categoryId, after = null;
      const visited = new Set();
      do {
        const result = await discussionQuery(`query BlackboardDiscussionCategory($owner:String!,$repo:String!,$after:String) {
          repository(owner:$owner,name:$repo) { id discussionCategories(first:100,after:$after) { nodes { id name } pageInfo { hasNextPage endCursor } } }
        }`, { owner, repo, after });
        const repository = result.data?.repository;
        if (!repository?.discussionCategories) throw new GitHubError('Enable Discussions on GitHub and check the token’s Discussions permission.');
        repositoryId = repository.id;
        categoryId = repository.discussionCategories.nodes.find((category) => category?.name.toLowerCase() === 'general')?.id;
        after = categoryId ? null : nextCursor(repository.discussionCategories, visited);
      } while (after);
      if (!categoryId) throw new GitHubError('Create a General discussion category on GitHub first.');
      const result = await discussionQuery(`mutation BlackboardCreateDiscussion($repository:ID!,$category:ID!,$title:String!,$body:String!) {
        createDiscussion(input:{repositoryId:$repository,categoryId:$category,title:$title,body:$body}) { discussion { ${discussionFields} } }
      }`, { repository: repositoryId, category: categoryId, title: name.trim(), body: topic.trim() ? topic : 'Start the conversation here.' }, true);
      if (!result.data?.createDiscussion?.discussion?.id) throw new GitHubError('Discussion creation unconfirmed. Check GitHub before trying again.', { uncertain: true });
      return discussion(result.data.createDiscussion.discussion);
    },
    async readDiscussionMessages(id) {
      const entries = [], visited = new Set();
      let after = null;
      do {
        const result = await discussionQuery(`query BlackboardDiscussionComments($id:ID!,$after:String) {
          node(id:$id) { ... on Discussion { comments(first:100,after:$after) {
            nodes { ${commentFields} replies(first:100) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } } }
            pageInfo { hasNextPage endCursor }
          } } }
        }`, { id: discussionNode(id), after });
        const connection = result.data?.node?.comments;
        if (!connection) throw new GitHubError('Could not read discussion messages.');
        for (const entry of connection.nodes.filter(Boolean)) {
          entries.push(discussionMessage(entry));
          const reference = { id: `dc:${entry.id}`, author: decodeMessage(entry.body || '').sender || entry.author?.login || 'Deleted user', url: entry.url };
          let replies = entry.replies;
          const replyCursors = new Set();
          while (replies) {
            entries.push(...replies.nodes.filter(Boolean).map((reply) => discussionMessage(reply, reference)));
            const cursor = nextCursor(replies, replyCursors);
            if (!cursor) break;
            const more = await discussionQuery(`query BlackboardDiscussionReplies($id:ID!,$after:String!) {
              node(id:$id) { ... on DiscussionComment { replies(first:100,after:$after) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } } } }
            }`, { id: entry.id, after: cursor });
            replies = more.data?.node?.replies;
            if (!replies) throw new GitHubError('Could not read discussion replies.');
          }
        }
        after = nextCursor(connection, visited);
      } while (after);
      return [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort(chronological);
    },
    async listProjectViews(projectId) {
      nodeId(projectId);
      const views = [], visited = new Set();
      let after = null;
      do {
        const result = await projectQuery(`query BlackboardProjectViews($id:ID!,$after:String) {
          node(id:$id) { ... on ProjectV2 { views(first:100,after:$after) {
            nodes { id number name layout filter } pageInfo { hasNextPage endCursor }
          } } }
        }`, { id: projectId, after });
        const connection = result.data?.node?.views;
        if (!connection) throw new GitHubError('Could not read project views.');
        views.push(...connection.nodes.filter(Boolean));
        after = nextCursor(connection, visited);
      } while (after);
      return views;
    },
    async projectViewItemIds(projectId, filter) {
      nodeId(projectId);
      const ids = [], visited = new Set();
      let after = null;
      do {
        const result = await projectQuery(`query BlackboardViewItems($id:ID!,$filter:String!,$after:String) {
          node(id:$id) { ... on ProjectV2 { items(first:100,after:$after,query:$filter) {
            nodes { id isArchived } pageInfo { hasNextPage endCursor }
          } } }
        }`, { id: projectId, filter, after });
        const connection = result.data?.node?.items;
        if (!connection) throw new GitHubError('Could not apply the view filter.');
        ids.push(...connection.nodes.filter((item) => item && !item.isArchived).map((item) => item.id));
        after = nextCursor(connection, visited);
      } while (after);
      return ids;
    },
    async createProjectView(projectId, { name, layout = 'BOARD_LAYOUT', filter = '' }) {
      nodeId(projectId);
      if (!['BOARD_LAYOUT', 'TABLE_LAYOUT'].includes(layout) || typeof name !== 'string' || !name.trim()) throw new GitHubError('Choose a view name and a Board or Table layout.');
      const result = await projectQuery(`mutation BlackboardCreateView($project:ID!,$name:String!,$layout:ProjectV2ViewLayout!) {
        createProjectV2View(input:{projectId:$project,name:$name,layout:$layout}) { projectV2View { id number name layout filter } }
      }`, { project: projectId, name: name.trim(), layout }, true);
      const view = result.data?.createProjectV2View?.projectV2View;
      if (!view?.id) throw new GitHubError('GitHub did not confirm view creation. Refresh before trying again.', { uncertain: true });
      if (filter.trim()) {
        try { return await api.updateProjectView(view.id, { filter }); }
        catch (failure) { failure.createdView = view; throw failure; }
      }
      return view;
    },
    async updateProjectView(viewId, changes) {
      nodeId(viewId);
      const input = { viewId };
      if (changes.name !== undefined) {
        if (typeof changes.name !== 'string' || !changes.name.trim()) throw new GitHubError('A view name is required.');
        input.name = changes.name.trim();
      }
      if (changes.layout !== undefined) {
        if (!['BOARD_LAYOUT', 'TABLE_LAYOUT'].includes(changes.layout)) throw new GitHubError('Choose Board or Table.');
        input.layout = changes.layout;
      }
      if (changes.filter !== undefined) input.filter = changes.filter.trim();
      const result = await projectQuery(`mutation BlackboardUpdateView($input:UpdateProjectV2ViewInput!) {
        updateProjectV2View(input:$input) { projectV2View { id number name layout filter } }
      }`, { input }, true);
      const view = result.data?.updateProjectV2View?.projectV2View;
      if (view?.id !== viewId) throw new GitHubError('GitHub did not confirm the view update. Refresh before trying again.', { uncertain: true });
      return view;
    },
    async deleteProjectView(viewId) {
      nodeId(viewId);
      const result = await projectQuery(`mutation BlackboardDeleteView($id:ID!) {
        deleteProjectV2View(input:{viewId:$id}) { projectV2View { id } }
      }`, { id: viewId }, true);
      if (result.data?.deleteProjectV2View?.projectV2View?.id !== viewId) throw new GitHubError('GitHub did not confirm view deletion. Refresh before trying again.', { uncertain: true });
    },
    async listProjects() {
      const projects = [];
      const visited = new Set();
      let after = null;
      do {
        const result = await projectQuery(`query BlackboardProjects($owner:String!,$repo:String!,$after:String) {
          repository(owner:$owner,name:$repo) { projectsV2(first:100,after:$after) {
            nodes { id number title url closed shortDescription viewerCanUpdate }
            pageInfo { hasNextPage endCursor }
          } }
        }`, { owner, repo, after });
        const connection = result.data?.repository?.projectsV2;
        if (!connection) throw new GitHubError('Could not read projects linked to this repository.');
        projects.push(...connection.nodes.filter(Boolean).map((item) => ({
          id: item.id, number: item.number, name: item.title, url: item.url,
          closed: item.closed, description: item.shortDescription || '', canUpdate: item.viewerCanUpdate,
        })));
        after = nextCursor(connection, visited);
      } while (after);
      return projects.sort((a, b) => Number(a.closed) - Number(b.closed) || a.number - b.number);
    },
    async readProject(id) {
      nodeId(id);
      const fields = [];
      let project;
      let after = null;
      const fieldCursors = new Set();
      do {
        const result = await projectQuery(`query BlackboardProjectFields($id:ID!,$after:String) {
          node(id:$id) { ... on ProjectV2 {
            id number title url closed shortDescription viewerCanUpdate
            fields(first:100,after:$after) {
              nodes { __typename ... on ProjectV2SingleSelectField { id name options { id name color description } } }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`, { id, after });
        project = result.data?.node;
        if (!project?.fields) throw new GitHubError('Project is unavailable or the token cannot access it.');
        fields.push(...project.fields.nodes.filter((field) => field?.__typename === 'ProjectV2SingleSelectField'));
        after = nextCursor(project.fields, fieldCursors);
      } while (after);
      const statusField = fields.find((field) => field.name.toLowerCase() === 'status') || null;
      const items = [];
      const itemCursors = new Set();
      do {
        const result = await projectQuery(`query BlackboardProjectItems($id:ID!,$after:String,$statusName:String!) {
          node(id:$id) { ... on ProjectV2 { items(first:100,after:$after) {
            nodes { id isArchived
              fieldValueByName(name:$statusName) { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } }
              content { __typename
                ... on Issue { id number title body url state repository { nameWithOwner } }
                ... on PullRequest { id number title url state repository { nameWithOwner } }
                ... on DraftIssue { id title body }
              }
            }
            pageInfo { hasNextPage endCursor }
          } } }
        }`, { id, after, statusName: statusField?.name || 'Status' });
        const connection = result.data?.node?.items;
        if (!connection) throw new GitHubError('Could not read project items.');
        for (const item of connection.nodes.filter((item) => item && !item.isArchived)) {
          const content = item.content;
          const localTopic = content?.__typename === 'Issue' && content.repository?.nameWithOwner.toLowerCase() === `${owner}/${repo}`.toLowerCase() && content.title.startsWith(CHANNEL_PREFIX);
          items.push({
            id: item.id, contentId: content?.id, title: localTopic ? content.title.slice(CHANNEL_PREFIX.length) : content?.title || 'Unavailable item',
            type: content?.__typename || 'Unavailable', url: content?.url || null,
            body: content?.body || '',
            number: content?.number ?? null, repository: content?.repository?.nameWithOwner || null,
            state: content?.state || null, channelId: localTopic ? content.number : null,
            statusId: item.fieldValueByName?.optionId ?? null,
          });
        }
        after = nextCursor(connection, itemCursors);
      } while (after);
      return {
        id: project.id, number: project.number, name: project.title, url: project.url,
        closed: project.closed, description: project.shortDescription || '', canUpdate: project.viewerCanUpdate,
        statusField, items,
      };
    },
    async setProjectItemStatus(projectId, itemId, fieldId, optionId) {
      [projectId, itemId, fieldId].forEach(nodeId);
      if (optionId !== null) nodeId(optionId);
      const clearing = optionId === null;
      const mutation = clearing ? 'clearProjectV2ItemFieldValue' : 'updateProjectV2ItemFieldValue';
      const result = await projectQuery(clearing
        ? `mutation BlackboardClearStatus($project:ID!,$item:ID!,$field:ID!) { clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field}) { projectV2Item { id } } }`
        : `mutation BlackboardSetStatus($project:ID!,$item:ID!,$field:ID!,$option:String!) { updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}) { projectV2Item { id } } }`,
      { project: projectId, item: itemId, field: fieldId, ...(clearing ? {} : { option: optionId }) }, true);
      if (!result.data?.[mutation]?.projectV2Item?.id) throw new GitHubError('Project update unconfirmed. Refresh the board before trying again.', { uncertain: true });
      return { id: itemId, statusId: optionId };
    },
    async addTopicToProject(projectId, channelId) {
      nodeId(projectId);
      const issue = await request(issuePath(channelId));
      if (!isTopic(issue) || !issue.node_id) throw new GitHubError('Only Blackboard topics can be added from this client.');
      const result = await projectQuery(`mutation BlackboardAddTopic($project:ID!,$content:ID!) { addProjectV2ItemById(input:{projectId:$project,contentId:$content}) { item { id } } }`, { project: projectId, content: issue.node_id }, true);
      const id = result.data?.addProjectV2ItemById?.item?.id;
      if (!id) throw new GitHubError('Project addition unconfirmed. Refresh the board before trying again.', { uncertain: true });
      return { id, channelId, contentId: issue.node_id, title: issue.title.slice(CHANNEL_PREFIX.length), type: 'Issue', number: channelId, url: issue.html_url, repository: `${owner}/${repo}`, state: issue.state.toUpperCase(), statusId: null };
    },
    async createProjectDraft(projectId, { title, body = '', fieldId = null, statusId = null }) {
      nodeId(projectId);
      if (typeof title !== 'string' || !title.trim()) throw new GitHubError('An item title is required.');
      if (statusId !== null) { nodeId(fieldId); nodeId(statusId); }
      const result = await projectQuery(`mutation BlackboardCreateDraft($project:ID!,$title:String!,$body:String!) {
        addProjectV2DraftIssue(input:{projectId:$project,title:$title,body:$body}) {
          projectItem { id content { ... on DraftIssue { id title body } } }
        }
      }`, { project: projectId, title: title.trim(), body }, true);
      const created = result.data?.addProjectV2DraftIssue?.projectItem;
      if (!created?.id || !created.content?.id) throw new GitHubError('Draft creation unconfirmed. Refresh the board before trying again.', { uncertain: true });
      const item = { id: created.id, contentId: created.content.id, title: created.content.title, body: created.content.body || '', type: 'DraftIssue', channelId: null, statusId: null, url: null, repository: null, state: null, number: null };
      if (statusId !== null) {
        try { await api.setProjectItemStatus(projectId, item.id, fieldId, statusId); }
        catch (failure) {
          const error = new GitHubError(`The draft was created, but its column could not be confirmed. ${failure.message}`, { uncertain: failure.uncertain, retryAt: failure.retryAt });
          error.createdItem = item;
          throw error;
        }
      }
      return { ...item, statusId };
    },
    async updateProjectDraft(draftId, { title, body = '' }) {
      nodeId(draftId);
      if (typeof title !== 'string' || !title.trim()) throw new GitHubError('An item title is required.');
      const result = await projectQuery(`mutation BlackboardEditDraft($id:ID!,$title:String!,$body:String!) {
        updateProjectV2DraftIssue(input:{draftIssueId:$id,title:$title,body:$body}) { draftIssue { id title body } }
      }`, { id: draftId, title: title.trim(), body }, true);
      const draft = result.data?.updateProjectV2DraftIssue?.draftIssue;
      if (!draft?.id) throw new GitHubError('Draft update unconfirmed. Refresh the board before trying again.', { uncertain: true });
      return { contentId: draft.id, title: draft.title, body: draft.body || '' };
    },
    async removeProjectItem(projectId, itemId) {
      [projectId, itemId].forEach(nodeId);
      const result = await projectQuery(`mutation BlackboardRemoveCard($project:ID!,$item:ID!) {
        deleteProjectV2Item(input:{projectId:$project,itemId:$item}) { deletedItemId }
      }`, { project: projectId, item: itemId }, true);
      if (result.data?.deleteProjectV2Item?.deletedItemId !== itemId) throw new GitHubError('Card removal unconfirmed. Refresh the board before trying again.', { uncertain: true });
      return { id: itemId };
    },
    async updateChannelDetails(id, { name, description = '' }) {
      const path = issuePath(id);
      if (typeof name !== 'string' || !name.trim()) throw new GitHubError('A topic name is required.');
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be edited.');
      return channel(await request(path, { method: 'PATCH', body: { title: CHANNEL_PREFIX + name.trim(), body: description } }));
    },
    async changeProjectColumn(projectId, { id = null, name, color = 'GRAY', description = '', direction = null, remove = false }) {
      nodeId(projectId);
      if (id !== null) nodeId(id);
      if ((remove || direction !== null) && id === null) throw new GitHubError('Choose a status column.');
      if (direction !== null && ![-1, 1].includes(direction)) throw new GitHubError('Invalid column direction.');
      if (!remove && direction === null && (typeof name !== 'string' || !name.trim())) throw new GitHubError('A column name is required.');
      if (!['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'].includes(color)) throw new GitHubError('Invalid column color.');
      // Fetch current options before replacing the field configuration. Retain every
      // existing option ID: omitting IDs would clear cards' status assignments.
      const snapshot = await api.readProject(projectId);
      const field = snapshot.statusField;
      if (!field) throw new GitHubError('This project has no Status field.');
      let options = field.options.map((option) => ({ id: option.id, name: option.name, color: option.color || 'GRAY', description: option.description || '' }));
      const index = options.findIndex((option) => option.id === id);
      if (id !== null && index < 0) throw new GitHubError('That column no longer exists. Refresh the board.');
      if (remove) {
        if (options.length <= 1) throw new GitHubError('Keep at least one status column.');
        options.splice(index, 1);
      } else if (direction !== null) {
        const destination = index + direction;
        if (destination < 0 || destination >= options.length) return field;
        [options[index], options[destination]] = [options[destination], options[index]];
      } else if (id === null) options.push({ name: name.trim(), color, description });
      else options[index] = { id, name: name.trim(), color, description };
      const result = await projectQuery(`mutation BlackboardChangeColumn($field:ID!,$options:[ProjectV2SingleSelectFieldOptionInput!]!) {
        updateProjectV2Field(input:{fieldId:$field,singleSelectOptions:$options}) {
          projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name color description } } }
        }
      }`, { field: field.id, options }, true);
      const updated = result.data?.updateProjectV2Field?.projectV2Field;
      if (!updated?.options) throw new GitHubError('Column update unconfirmed. Refresh the board before trying again.', { uncertain: true });
      return updated;
    },
    async listTags() {
      // Suggest only names in use, rather than GitHub's unused default labels.
      const issues = await listAll('/issues?state=all&sort=created&direction=asc');
      const tags = topicTags(issues.flatMap((issue) => issue.labels || []).filter((item) => !item.archived_at));
      return [...new Map(tags.map((tag) => [tag.name.toLowerCase(), tag])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async addChannelTag(id, name) {
      if (isDiscussionId(id)) return changeDiscussionLabel(id, tagName(name), true);
      const path = issuePath(id);
      name = tagName(name);
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be tagged.');
      let label;
      try {
        const labelPath = `/labels/${encodeURIComponent(name)}`;
        try { label = await request(labelPath); }
        catch (failure) {
          if (failure.status !== 404) throw failure;
          try { label = await request('/labels', { method: 'POST', body: { name, color: '52769b' } }); }
          catch (creationFailure) {
            if (creationFailure.status !== 422) throw creationFailure;
            label = await request(labelPath); // Another client may have created it.
          }
        }
      } catch (failure) { failure.tagNotApplied = true; throw failure; }
      return topicTags(await request(`${path}/labels`, { method: 'POST', body: { labels: [label.name] } }));
    },
    async removeChannelTag(id, name) {
      if (isDiscussionId(id)) return changeDiscussionLabel(id, tagName(name), false);
      const path = issuePath(id);
      name = tagName(name);
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be tagged.');
      return topicTags(await request(`${path}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }));
    },
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
      if (typeof commentId === 'string' && commentId.startsWith('dc:')) {
        const entries = [], visited = new Set();
        let after = null;
        do {
          const result = await discussionQuery(`query BlackboardDiscussionReactions($id:ID!,$after:String) {
            node(id:$id) { ... on DiscussionComment { reactions(first:100,after:$after) { nodes { id content user { login } } pageInfo { hasNextPage endCursor } } } }
          }`, { id: nodeId(commentId.slice(3)), after });
          const connection = result.data?.node?.reactions;
          if (!connection) throw new GitHubError('Could not read reactions.');
          entries.push(...connection.nodes.filter(Boolean).map((entry) => ({ id: entry.id, type: REACTION_TYPES[REACTION_ENUMS.indexOf(entry.content)], author: entry.user?.login || 'Deleted user' })));
          after = nextCursor(connection, visited);
        } while (after);
        return entries;
      }
      return (await listAll(reactionPath(commentId))).map(reaction);
    },
    async addReaction(commentId, type) {
      if (!REACTION_TYPES.includes(type)) throw new GitHubError('Unsupported reaction.');
      if (typeof commentId === 'string' && commentId.startsWith('dc:')) {
        const result = await discussionQuery(`mutation BlackboardDiscussionReact($id:ID!,$content:ReactionContent!) {
          addReaction(input:{subjectId:$id,content:$content}) { reaction { id content user { login } } }
        }`, { id: nodeId(commentId.slice(3)), content: REACTION_ENUMS[REACTION_TYPES.indexOf(type)] }, true);
        const entry = result.data?.addReaction?.reaction;
        if (!entry?.id) throw new GitHubError('Reaction unconfirmed. Refresh before trying again.', { uncertain: true });
        return { id: entry.id, type, author: entry.user?.login || 'Deleted user' };
      }
      return reaction(await request(reactionPath(commentId), { method: 'POST', body: { content: type } }));
    },
    async removeReaction(commentId, reactionId) {
      if (typeof commentId === 'string' && commentId.startsWith('dc:')) {
        const entries = await api.listReactions(commentId);
        // The UI passes an owned reaction ID; resolve its type again before removal.
        const viewer = await api.getViewer();
        const own = entries.find((entry) => entry.id === reactionId && entry.author === viewer);
        if (!own) throw new GitHubError('Your reaction is no longer present. Refresh before trying again.');
        const id = nodeId(commentId.slice(3));
        const result = await discussionQuery(`mutation BlackboardDiscussionUnreact($id:ID!,$content:ReactionContent!) {
          removeReaction(input:{subjectId:$id,content:$content}) { subject { id } }
        }`, { id, content: REACTION_ENUMS[REACTION_TYPES.indexOf(own.type)] }, true);
        if (result.data?.removeReaction?.subject?.id !== id) throw new GitHubError('Reaction removal unconfirmed. Refresh before trying again.', { uncertain: true });
        return;
      }
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
      if (isDiscussionId(id)) return discussionState(id, true);
      return channel(await request(issuePath(id), { method: 'PATCH', body: { state: 'closed', state_reason: 'not_planned' } }));
    },
    async reopenChannel(id) {
      if (isDiscussionId(id)) return discussionState(id, false);
      return channel(await request(issuePath(id), { method: 'PATCH', body: { state: 'open' } }));
    },
    async closeChannelTree(id, onChange = () => {}) {
      if (isDiscussionId(id)) { onChange(await api.closeChannel(id)); return; }
      const tree = await topicTree(id);
      for (const item of tree) {
        try {
          if (item.state !== 'closed') await api.closeChannel(item.id);
        } catch (failure) { failure.affectedChannelId = item.id; throw failure; }
        onChange({ ...item, state: 'closed' });
      }
    },
    async archiveChannelTree(id, onChange = () => {}) {
      if (isDiscussionId(id)) { await api.archiveChannel(id); onChange({ id, archived: true }); return; }
      const tree = await topicTree(id);
      for (const item of tree) {
        try {
          if (!item.archived) await api.archiveChannel(item.id);
        } catch (failure) { failure.affectedChannelId = item.id; throw failure; }
        onChange({ ...item, archived: true });
      }
    },
    async archiveChannel(id) {
      if (isDiscussionId(id)) { await changeDiscussionLabel(id, ARCHIVED_LABEL, true); return { id, archived: true }; }
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
      if (isDiscussionId(id)) {
        const result = await discussionQuery(`mutation BlackboardDeleteDiscussion($id:ID!) {
          deleteDiscussion(input:{id:$id}) { discussion { id } }
        }`, { id: discussionNode(id) }, true);
        if (result.data?.deleteDiscussion?.discussion?.id !== discussionNode(id)) throw new GitHubError('Deletion unconfirmed. Check GitHub before trying again.', { uncertain: true });
        return { id, deleted: true };
      }
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
      if (isDiscussionId(id)) return api.deleteChannel(id);
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
      if (isDiscussionId(id)) return api.readDiscussionMessages(id);
      return (await listAll(`${issuePath(id)}/comments`)).map(message);
    },
    async sendMessage(id, text, { sender = null } = {}) {
      if (!text.trim()) throw new GitHubError('A message is required.');
      if (isDiscussionId(id)) {
        const result = await discussionQuery(`mutation BlackboardDiscussionSend($id:ID!,$body:String!) {
          addDiscussionComment(input:{discussionId:$id,body:$body}) { comment { ${commentFields} } }
        }`, { id: discussionNode(id), body: encodeMessage(text, sender) }, true);
        const entry = result.data?.addDiscussionComment?.comment;
        if (!entry?.id) throw new GitHubError('Message delivery unconfirmed. Check GitHub before resending.', { uncertain: true });
        return discussionMessage(entry);
      }
      return message(await request(`${issuePath(id)}/comments`, { method: 'POST', body: { body: encodeMessage(text, sender) } }));
    },
  };
  return api;
}
