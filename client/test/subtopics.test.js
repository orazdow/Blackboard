import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/api.js';
import { topicRows, createTopicTracker } from '../src/topic-state.js';

const issue = (number, extra = {}) => ({
  id: 1000 + number, number, node_id: `I_${number}`, title: `💬 topic-${number}`,
  state: 'open', body: '', labels: [], repository_url: 'https://api.github.com/repos/example/chat',
  html_url: `https://github.com/example/chat/issues/${number}`, sub_issues_summary: { total: 0 }, ...extra,
});
const client = (fetch) => createGitHubClient({ token: 'test', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0 });
const root = issue(1, { sub_issues_summary: { total: 1 } });
const child = issue(2, { sub_issues_summary: { total: 1 } });
const leaf = issue(3);
const treeFetch = (writes) => async (url, options) => {
  const path = new URL(url).pathname;
  if (options.method === 'PATCH') {
    const id = Number(path.split('/').at(-1));
    writes.push(id);
    return Response.json(issue(id, { state: JSON.parse(options.body).state }));
  }
  if (path.endsWith('/1/sub_issues')) return Response.json([child]);
  if (path.endsWith('/2/sub_issues')) return Response.json([leaf]);
  if (path.endsWith('/1')) return Response.json(root);
  assert.fail(`Unexpected request ${url}`);
};

test('listing nests local topics using GitHub relationships, never issue-number collisions in another repo', async () => {
  const api = client(async (url) => {
    if (url.includes('/1/sub_issues')) return Response.json([child, issue(3, { repository_url: 'https://api.github.com/repos/example/other' })]);
    if (url.includes('/2/sub_issues')) return Response.json([leaf]);
    return Response.json([root, child, leaf, issue(4)]);
  });
  const topics = await api.listChannels({ includeHierarchy: true });
  assert.deepEqual(topics.map(({ id, parentId }) => [id, parentId]), [[1, null], [2, 1], [3, 2], [4, null]]);
});

test('subtopic creation attaches the numeric database ID, not the issue number', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(options.method === 'GET' ? root : leaf);
  });
  const result = await api.createChannel({ name: 'Child', parentId: 1 });
  assert.equal(result.parentId, 1);
  assert.equal(calls[2].url, 'https://api.github.com/repos/example/chat/issues/1/sub_issues');
  assert.deepEqual(JSON.parse(calls[2].body), { sub_issue_id: 1003 });
});

test('failed attachment exposes the already-created topic without creating it again', async () => {
  let creates = 0;
  const api = client(async (url, options) => {
    if (options.method === 'GET') return Response.json(root);
    if (url.endsWith('/issues')) { creates++; return Response.json(leaf); }
    return Response.json({ message: 'Not allowed' }, { status: 403 });
  });
  await assert.rejects(api.createChannel({ name: 'Child', parentId: 1 }), (error) => error.createdChannel.id === 3 && /was created/.test(error.message));
  assert.equal(creates, 1);
});

test('closing traverses grandchildren before parents; reopening only changes the selected topic', async () => {
  const writes = [];
  const api = client(treeFetch(writes));
  const changes = [];
  await api.closeChannelTree(1, (item) => changes.push(item));
  assert.deepEqual(writes, [3, 2, 1]);
  assert.deepEqual(changes.map(({ id, state }) => [id, state]), [[3, 'closed'], [2, 'closed'], [1, 'closed']]);
  writes.length = 0;
  await api.reopenChannel(1);
  assert.deepEqual(writes, [1]);
});

test('a failed cascade preserves progress and stops before changing the parent', async () => {
  const writes = [];
  const normal = treeFetch(writes);
  const api = client(async (url, options) => {
    if (options.method === 'PATCH' && url.endsWith('/2')) return Response.json({ message: 'Denied' }, { status: 403 });
    return normal(url, options);
  });
  const changed = [];
  await assert.rejects(api.closeChannelTree(1, (item) => changed.push(item.id)), (error) => error.affectedChannelId === 2);
  assert.deepEqual(writes, [3]);
  assert.deepEqual(changed, [3]);
});

test('archiving cascades labels without closing any topic', async () => {
  const archived = [];
  const normal = treeFetch([]);
  const api = client(async (url, options) => {
    if (url.includes('/labels/')) return Response.json({ name: 'blackboard:archived' });
    if (options.method === 'POST' && url.endsWith('/labels')) {
      archived.push(Number(new URL(url).pathname.split('/').at(-2)));
      return Response.json([]);
    }
    assert.notEqual(options.method, 'PATCH');
    return normal(url, options);
  });
  const changed = [];
  await api.archiveChannelTree(1, (item) => changed.push(item));
  assert.deepEqual(archived, [3, 2, 1]);
  assert.ok(changed.every((item) => item.archived && item.state === 'open'));
});

test('deleting detaches direct children and deletes only the parent', async () => {
  const actions = [];
  const api = client(async (url, options) => {
    if (url.endsWith('/graphql')) {
      actions.push(['delete', JSON.parse(options.body).variables.id]);
      return Response.json({ data: { deleteIssue: { repository: { id: 'repo' } } } });
    }
    if (options.method === 'DELETE') {
      actions.push(['detach', JSON.parse(options.body).sub_issue_id]);
      return Response.json(root);
    }
    if (url.includes('/sub_issues?')) return Response.json([child]);
    return Response.json(root);
  });
  const changed = [];
  await api.deleteChannelPreservingChildren(1, (item) => changed.push(item));
  assert.deepEqual(actions, [['detach', 1002], ['delete', 'I_1']]);
  assert.equal(changed[0].parentId, null);
});

test('failed detachment prevents deletion', async () => {
  const api = client(async (url, options) => {
    assert.ok(!url.endsWith('/graphql'));
    if (options.method === 'DELETE') return Response.json({ message: 'Denied' }, { status: 403 });
    return Response.json(url.includes('/sub_issues?') ? [child] : root);
  });
  await assert.rejects(api.deleteChannelPreservingChildren(1), /Denied/);
});

test('sidebar ordering supports nesting, collapsing, and orphaned children', () => {
  const topics = [{ id: 3, parentId: 2 }, { id: 2, parentId: 1 }, { id: 1 }, { id: 4, parentId: 99 }];
  assert.deepEqual(topicRows(topics).map(({ id, depth }) => [id, depth]), [[1, 0], [2, 1], [3, 2], [4, 0]]);
  assert.deepEqual(topicRows(topics, new Set([1])).map(({ id }) => id), [1, 4]);
  assert.deepEqual(topicRows(topics.filter((item) => item.id !== 1)).map(({ id, depth }) => [id, depth]), [[2, 0], [3, 1], [4, 0]]);
  assert.equal(topicRows([{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }]).length, 2);
});

test('stale hierarchy polls cannot orphan a newly attached topic', () => {
  const tracker = createTopicTracker();
  tracker.remember({ id: 2, name: 'Child', state: 'open', archived: false, parentId: 1 });
  assert.equal(tracker.reconcile([{ id: 2, name: 'Child', state: 'open', archived: false, parentId: null }])[0].parentId, 1);
});
