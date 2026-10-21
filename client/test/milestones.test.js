import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/api.js';
import { createMilestoneTracker } from '../src/milestone-state.js';
import { createTopicTracker } from '../src/topic-state.js';

const raw = (number, extra = {}) => ({ number, title: `Target ${number}`, description: '', state: 'open', due_on: null, html_url: `https://github.com/example/chat/milestone/${number}`, open_issues: 3, closed_issues: 1, ...extra });
const issue = (extra = {}) => ({ number: 1, title: '💬 Topic', state: 'open', labels: [], ...extra });
const client = (fetch) => createGitHubClient({ token: 'test', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0 });

test('milestones follow pagination, include closed when requested, and use repository completion counts', async () => {
  let calls = 0;
  const api = client(async (url) => {
    assert.match(url, /state=all/);
    return Response.json(++calls === 1 ? [raw(1)] : [raw(2, { state: 'closed', open_issues: 0, closed_issues: 0 })], {
      headers: calls === 1 ? { link: '<https://api.github.com/repos/example/chat/milestones?state=all&per_page=100&page=2>; rel="next"' } : {},
    });
  });
  const items = await api.listMilestones({ includeClosed: true });
  assert.equal(items[0].progress, 25);
  assert.equal(items[0].open, 3);
  assert.equal(items[0].closed, 1);
  assert.equal(items[1].state, 'closed');
  assert.equal(items[1].progress, 0);
});

test('creates milestones with optional dates, edits them, and clears a date explicitly', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json(raw(7, { due_on: '2026-11-12T00:00:00Z' }));
  });
  const created = await api.createMilestone({ name: ' Release ', description: 'First target', dueDate: '2026-11-12' });
  assert.equal(created.id, 7);
  assert.equal(created.dueDate, '2026-11-12');
  assert.deepEqual(calls[0].body, { title: 'Release', description: 'First target', due_on: '2026-11-12T00:00:00.000Z' });
  await api.createMilestone({ name: 'No deadline' });
  assert.ok(!('due_on' in calls[1].body));
  await api.updateMilestone(7, { name: 'Renamed', description: 'Updated', dueDate: null });
  assert.equal(calls[2].method, 'PATCH');
  assert.ok(calls[2].url.endsWith('/milestones/7'));
  assert.deepEqual(calls[2].body, { title: 'Renamed', description: 'Updated', due_on: null });
});

test('closing and reopening a milestone changes no issue states', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    assert.ok(url.endsWith('/milestones/7'));
    const body = JSON.parse(options.body);
    calls.push(body);
    return Response.json(raw(7, { state: body.state }));
  });
  await api.updateMilestone(7, { state: 'closed' });
  await api.updateMilestone(7, { state: 'open' });
  assert.deepEqual(calls, [{ state: 'closed' }, { state: 'open' }]);
});

test('assignment uses milestone number, removal sends null, and neither touches descendants', async () => {
  const writes = [];
  const api = client(async (url, options) => {
    assert.ok(url.endsWith('/issues/1'));
    if (options.method === 'GET') return Response.json(issue());
    const body = JSON.parse(options.body);
    writes.push(body);
    return Response.json(issue({ milestone: body.milestone ? { number: body.milestone } : null }));
  });
  assert.equal((await api.setChannelMilestone(1, 7)).milestoneId, 7);
  assert.equal((await api.setChannelMilestone(1, null)).milestoneId, null);
  assert.deepEqual(writes, [{ milestone: 7 }, { milestone: null }]);
});

test('invalid milestone input fails without requests; unrelated issues cannot be assigned', async () => {
  const api = client(async () => assert.fail('Unexpected request'));
  await assert.rejects(api.createMilestone({ name: ' ' }), /name is required/);
  for (const dueDate of ['2026-02-30', '2026-13-01', 'tomorrow']) {
    await assert.rejects(api.createMilestone({ name: 'X', dueDate }), /due date/);
  }
  await assert.rejects(api.updateMilestone(0, { state: 'closed' }), /Invalid milestone ID/);
  await assert.rejects(api.updateMilestone(1, { state: 'archived' }), /Invalid milestone state/);
  await assert.rejects(api.setChannelMilestone(1, -7), /Invalid milestone ID/);
  let calls = 0;
  const unrelated = client(async () => { calls++; return Response.json(issue({ title: 'Unrelated' })); });
  await assert.rejects(unrelated.setChannelMilestone(1, 7), /Only Blackboard topics/);
  assert.equal(calls, 1);
});

test('uncertain milestone creation is never retried automatically', async () => {
  let calls = 0;
  const api = client(async () => { calls++; throw new TypeError('connection lost'); });
  await assert.rejects(api.createMilestone({ name: 'Release' }), (error) => error.uncertain);
  assert.equal(calls, 1);
});

test('new and edited milestones survive stale polls, then accept updated counts after confirmation', () => {
  const tracker = createMilestoneTracker();
  const saved = { id: 7, name: 'Release', description: '', dueDate: null, state: 'open', progress: 0 };
  tracker.remember(saved);
  assert.equal(tracker.reconcile([])[0].syncState, 'confirming');
  assert.equal(tracker.reconcile([{ ...saved, name: 'Old title' }])[0].name, 'Release');
  assert.equal(tracker.reconcile([saved])[0].syncState, undefined);
  assert.equal(tracker.reconcile([{ ...saved, progress: 50 }])[0].progress, 50);
  assert.deepEqual(tracker.reconcile([]), []);
});

test('stale topic polls cannot undo milestone assignment or removal', () => {
  const tracker = createTopicTracker();
  const topic = { id: 1, name: 'Topic', state: 'open', archived: false, parentId: null, milestoneId: 7 };
  tracker.remember(topic);
  assert.equal(tracker.reconcile([{ ...topic, milestoneId: null }])[0].milestoneId, 7);
  tracker.reconcile([topic]);
  tracker.remember({ ...topic, milestoneId: null });
  assert.equal(tracker.reconcile([topic])[0].milestoneId, null);
});
