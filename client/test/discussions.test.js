import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient, isDiscussionId } from '../src/api.js';
import { createTopicTracker } from '../src/topic-state.js';

const client = (fetch) => createGitHubClient({ token: 'repo-token', projectToken: 'project-token', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0 });
const connection = (nodes, next = null) => ({ nodes, pageInfo: { hasNextPage: Boolean(next), endCursor: next } });
const entry = (extra = {}) => ({ id: 'DISC_1', number: 4, title: 'Ideas', body: 'Description', closed: false, url: 'https://github.com/example/chat/discussions/4', category: { id: 'GENERAL', name: 'General' }, labels: connection([]), ...extra });
const comment = (id, time, extra = {}) => ({ id, body: `_@dot\n${id}`, author: { login: 'account' }, createdAt: `2026-10-21T12:${time}:00Z`, url: `https://github.com/example/chat/discussions/4#${id}`, reactionGroups: [], ...extra });
const success = (data) => Response.json({ data });

test('discussion listings paginate with the repository credential and keep unprefixed titles', async () => {
  const api = client(async (url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer repo-token');
    const { variables } = JSON.parse(request.body);
    return success({ repository: { hasDiscussionsEnabled: true, discussions: variables.after
      ? connection([entry({ id: 'DISC_2', number: 5, closed: true })])
      : connection([entry()], 'next') } });
  });
  const topics = await api.listDiscussions({ includeClosed: true });
  assert.equal(topics.length, 2);
  assert.equal(topics[0].id, 'discussion:DISC_1');
  assert.equal(topics[0].name, 'Ideas');
  assert.equal(topics[0].kind, 'discussion');
  assert.equal(topics[1].state, 'closed');
});

test('closed and archived discussions are filtered independently; disabled discussions return an empty list', async () => {
  const api = client(() => success({ repository: { hasDiscussionsEnabled: true, discussions: connection([
    entry(), entry({ id: 'CLOSED', closed: true }), entry({ id: 'ARCHIVE', labels: connection([{ name: 'blackboard:archived' }]) }),
  ]) } }));
  assert.equal((await api.listDiscussions()).length, 1);
  assert.equal((await api.listDiscussions({ includeClosed: true })).length, 2);
  assert.equal((await api.listDiscussions({ includeArchived: true })).length, 2);
  assert.deepEqual(await client(() => success({ repository: { hasDiscussionsEnabled: false } })).listDiscussions(), []);
});

test('discussion labels paginate and archive metadata is omitted from tags', async () => {
  const api = client(async (url, request) => {
    const { query } = JSON.parse(request.body);
    if (query.includes('BlackboardDiscussionLabels')) return success({ node: { labels: connection([{ name: 'design', color: '112233' }]) } });
    return success({ node: entry({ labels: connection([{ name: 'blackboard:archived' }], 'more') }) });
  });
  const topic = await api.readDiscussion('discussion:DISC_1');
  assert.equal(topic.archived, true);
  assert.deepEqual(topic.tags.map((tag) => tag.name), ['design']);
});

test('creation finds General across pages, uses a plain title, and never creates an issue', async () => {
  let writes = 0;
  const api = client(async (url, request) => {
    const { query, variables } = JSON.parse(request.body);
    assert.ok(!query.includes('createIssue'));
    if (query.includes('BlackboardDiscussionCategory')) return success({ repository: { id: 'REPO', discussionCategories: variables.after
      ? connection([{ id: 'GENERAL', name: 'General' }]) : connection([{ id: 'QA', name: 'Q&A' }], 'next') } });
    writes++;
    assert.deepEqual(variables, { repository: 'REPO', category: 'GENERAL', title: 'Ideas', body: 'Description' });
    return success({ createDiscussion: { discussion: entry() } });
  });
  assert.equal((await api.createDiscussion({ name: ' Ideas ', topic: 'Description' })).id, 'discussion:DISC_1');
  assert.equal(writes, 1);
});

test('missing General category prevents creation rather than choosing an unintended format', async () => {
  const api = client(() => success({ repository: { id: 'REPO', discussionCategories: connection([{ id: 'QA', name: 'Q&A' }]) } }));
  await assert.rejects(api.createDiscussion({ name: 'Ideas' }), /General/);
});

test('comments and all reply pages are merged chronologically rather than grouped by their parents', async () => {
  const api = client(async (url, request) => {
    const { query, variables } = JSON.parse(request.body);
    if (query.includes('BlackboardDiscussionReplies')) {
      assert.equal(variables.id, 'PARENT');
      return success({ node: { replies: connection([comment('REPLY_2', '05')]) } });
    }
    return success({ node: { comments: variables.after
      ? connection([comment('LATER_PARENT', '03', { replies: connection([]) })])
      : connection([comment('PARENT', '01', { replies: connection([comment('REPLY_1', '04', { reactionGroups: [{ content: 'HEART', users: { totalCount: 2 } }] })], 'more-replies') })], 'more-comments') } });
  });
  const messages = await api.readMessages('discussion:DISC_1');
  assert.deepEqual(messages.map((message) => message.id), ['dc:PARENT', 'dc:LATER_PARENT', 'dc:REPLY_1', 'dc:REPLY_2']);
  assert.equal(messages[2].sender, 'dot');
  assert.equal(messages[2].replyTo.author, 'dot');
  assert.equal(messages[2].replyTo.id, 'dc:PARENT');
  assert.deepEqual(messages[2].reactions, ['heart']);
});

test('discussion sends use the sender convention and remain top-level comments', async () => {
  const api = client(async (url, request) => {
    const { query, variables } = JSON.parse(request.body);
    assert.ok(!query.includes('replyToId'));
    assert.deepEqual(variables, { id: 'DISC_1', body: '_@chatgpt\nHello' });
    return success({ addDiscussionComment: { comment: comment('NEW', '02', { body: variables.body }) } });
  });
  const sent = await api.sendMessage('discussion:DISC_1', 'Hello', { sender: 'chatgpt' });
  assert.equal(sent.text, 'Hello');
  assert.equal(sent.sender, 'chatgpt');
  assert.equal(sent.replyTo, null);
});

test('discussion close/reopen and delete route through GraphQL without touching issue trees', async () => {
  const api = client(async (url, request) => {
    const { query, variables } = JSON.parse(request.body);
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(variables.id, 'DISC_1');
    if (query.includes('closeDiscussion(')) return success({ closeDiscussion: { discussion: entry({ closed: true }) } });
    if (query.includes('reopenDiscussion(')) return success({ reopenDiscussion: { discussion: entry() } });
    assert.ok(query.includes('deleteDiscussion(input:{id:$id})'));
    return success({ deleteDiscussion: { discussion: { id: 'DISC_1' } } });
  });
  let closed;
  await api.closeChannelTree('discussion:DISC_1', (topic) => { closed = topic; });
  assert.equal(closed.state, 'closed');
  assert.equal((await api.reopenChannel('discussion:DISC_1')).state, 'open');
  assert.equal((await api.deleteChannelPreservingChildren('discussion:DISC_1')).deleted, true);
});

test('discussion tagging creates a label when necessary, adds it without replacing other tags, and removes only its assignment', async () => {
  let assigned = false, created = false;
  const api = client(async (url, request) => {
    if (url.endsWith('/labels/design')) {
      if (!created) return Response.json({ message: 'Not found' }, { status: 404 });
      assert.equal(request.method, 'GET');
      return Response.json({ node_id: 'LABEL', name: 'design' });
    }
    if (url.endsWith('/labels')) { created = true; return Response.json({ node_id: 'LABEL', name: 'design' }); }
    const { query, variables } = JSON.parse(request.body);
    if (query.includes('BlackboardDiscussionTag')) {
      assert.deepEqual(variables, { id: 'DISC_1', labels: ['LABEL'] });
      assigned = query.includes('addLabelsToLabelable');
      return success({ [assigned ? 'addLabelsToLabelable' : 'removeLabelsFromLabelable']: { labelable: { id: 'DISC_1' } } });
    }
    return success({ node: entry({ labels: connection([{ name: 'existing' }, ...(assigned ? [{ name: 'design' }] : [])]) }) });
  });
  assert.deepEqual((await api.addChannelTag('discussion:DISC_1', 'design')).map((tag) => tag.name), ['existing', 'design']);
  assert.deepEqual((await api.removeChannelTag('discussion:DISC_1', 'design')).map((tag) => tag.name), ['existing']);
});

test('discussion reaction removal resolves the viewer’s reaction and uses its type, not a REST ID', async () => {
  const api = client(async (url, request) => {
    if (url.endsWith('/user')) return Response.json({ login: 'me' });
    const { query, variables } = JSON.parse(request.body);
    if (query.includes('BlackboardDiscussionReactions')) return success({ node: { reactions: connection([{ id: 'REACTION', content: 'HEART', user: { login: 'me' } }]) } });
    assert.deepEqual(variables, { id: 'COMMENT', content: 'HEART' });
    return success({ removeReaction: { subject: { id: 'COMMENT' } } });
  });
  await api.removeReaction('dc:COMMENT', 'REACTION');
});

test('unacknowledged discussion writes are uncertain and never automatically retried', async () => {
  let calls = 0;
  const api = client(() => { calls++; return success({}); });
  await assert.rejects(api.sendMessage('discussion:DISC_1', 'Hello'), (failure) => failure.uncertain);
  assert.equal(calls, 1);
});

test('discussion IDs remain distinct from issue IDs in pending changes and deletions', () => {
  const tracker = createTopicTracker();
  const discussion = { id: 'discussion:DISC_1', number: 4, name: 'Chat', state: 'open', archived: false };
  tracker.remember(discussion);
  assert.equal(tracker.reconcile([{ id: 4, name: 'Task' }]).length, 2);
  tracker.remove(discussion.id);
  assert.deepEqual(tracker.reconcile([{ id: 4, name: 'Task' }, discussion]).map((topic) => topic.id), [4]);
  assert.equal(isDiscussionId('discussion:../../bad'), false);
});
