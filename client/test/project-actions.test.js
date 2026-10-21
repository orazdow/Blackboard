import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/api.js';
import { createProjectTracker, sameProjectColumns } from '../src/project-state.js';

const client = (fetch) => createGitHubClient({ token: 'repo-token', projectToken: 'project-token', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0 });
const options = [{ id: 'todo', name: 'Todo', color: 'GREEN', description: 'Ready' }, { id: 'done', name: 'Done', color: 'PURPLE', description: 'Finished' }];
const field = { __typename: 'ProjectV2SingleSelectField', id: 'FIELD_1', name: 'Status', options };
const connection = (nodes) => ({ nodes, pageInfo: { hasNextPage: false } });
const draft = { id: 'ITEM_1', content: { id: 'DRAFT_1', title: 'Idea', body: 'Details' } };

test('draft creation posts a project-only draft and assigns the requested column', async () => {
  const queries = [];
  const api = client(async (url, request) => {
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(request.headers.Authorization, 'Bearer project-token');
    const { query, variables } = JSON.parse(request.body);
    queries.push(query);
    if (query.includes('BlackboardCreateDraft')) {
      assert.deepEqual(variables, { project: 'PVT_1', title: 'Idea', body: 'Details' });
      return Response.json({ data: { addProjectV2DraftIssue: { projectItem: draft } } });
    }
    assert.equal(variables.option, 'todo');
    return Response.json({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });
  });
  const created = await api.createProjectDraft('PVT_1', { title: ' Idea ', body: 'Details', fieldId: 'FIELD_1', statusId: 'todo' });
  assert.equal(created.type, 'DraftIssue');
  assert.equal(created.statusId, 'todo');
  assert.equal(created.channelId, null);
  assert.equal(queries.length, 2);
});

test('a draft survives failed column assignment without duplicate creation', async () => {
  let creates = 0;
  const api = client(async (url, request) => {
    const { query } = JSON.parse(request.body);
    if (query.includes('BlackboardCreateDraft')) { creates++; return Response.json({ data: { addProjectV2DraftIssue: { projectItem: draft } } }); }
    return Response.json({ errors: [{ type: 'FORBIDDEN', message: 'Denied' }] });
  });
  await assert.rejects(api.createProjectDraft('PVT_1', { title: 'Idea', fieldId: 'FIELD_1', statusId: 'todo' }), (error) => error.createdItem.id === 'ITEM_1' && error.createdItem.statusId === null);
  assert.equal(creates, 1);
});

test('draft edits target the draft content ID; card removal targets the project item only', async () => {
  const api = client(async (url, request) => {
    const { query, variables } = JSON.parse(request.body);
    assert.ok(!query.includes('deleteIssue('));
    if (query.includes('BlackboardEditDraft')) {
      assert.equal(variables.id, 'DRAFT_1');
      return Response.json({ data: { updateProjectV2DraftIssue: { draftIssue: { id: 'DRAFT_1', title: 'Updated', body: 'More detail' } } } });
    }
    assert.deepEqual(variables, { project: 'PVT_1', item: 'ITEM_1' });
    return Response.json({ data: { deleteProjectV2Item: { deletedItemId: 'ITEM_1' } } });
  });
  assert.equal((await api.updateProjectDraft('DRAFT_1', { title: 'Updated', body: 'More detail' })).title, 'Updated');
  await api.removeProjectItem('PVT_1', 'ITEM_1');
});

test('missing removal acknowledgement is uncertain and never retried', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return Response.json({ data: {} }); });
  await assert.rejects(api.removeProjectItem('PVT_1', 'ITEM_1'), (error) => error.uncertain);
  assert.equal(calls, 1);
});

function columnClient(check, currentOptions = options) {
  return client(async (url, request) => {
    const { query, variables } = JSON.parse(request.body);
    if (query.includes('BlackboardProjectFields')) return Response.json({ data: { node: { id: 'PVT_1', title: 'Board', fields: connection([{ ...field, options: currentOptions }]) } } });
    if (query.includes('BlackboardProjectItems')) return Response.json({ data: { node: { items: connection([]) } } });
    assert.ok(query.includes('BlackboardChangeColumn'));
    check(variables);
    return Response.json({ data: { updateProjectV2Field: { projectV2Field: { ...field, options: variables.options.map((option) => ({ ...option, id: option.id || 'new' })) } } } });
  });
}

test('column edits preserve IDs and all other status options, so existing assignments survive', async () => {
  const api = columnClient((variables) => {
    assert.equal(variables.field, 'FIELD_1');
    assert.deepEqual(variables.options, [{ id: 'todo', name: 'Ready', color: 'BLUE', description: 'New detail' }, options[1]]);
  });
  await api.changeProjectColumn('PVT_1', { id: 'todo', name: 'Ready', color: 'BLUE', description: 'New detail' });
});

test('moving a column changes option order while retaining every option ID', async () => {
  const api = columnClient((variables) => assert.deepEqual(variables.options, [options[1], options[0]]));
  await api.changeProjectColumn('PVT_1', { id: 'done', direction: -1 });
});

test('deleting a column removes only its status option, without deleting cards or issues', async () => {
  const api = columnClient((variables) => assert.deepEqual(variables.options, [options[1]]));
  await api.changeProjectColumn('PVT_1', { id: 'todo', remove: true });
});

test('creating a column appends it without replacing existing options', async () => {
  const api = columnClient((variables) => assert.deepEqual(variables.options, [...options, { name: 'Review', color: 'BLUE', description: '' }]));
  assert.equal((await api.changeProjectColumn('PVT_1', { name: 'Review', color: 'BLUE' })).options[2].id, 'new');
});

test('cannot delete the last status column or target a disappeared column', async () => {
  const api = columnClient(() => assert.fail('Unexpected mutation'), [options[0]]);
  await assert.rejects(api.changeProjectColumn('PVT_1', { id: 'todo', remove: true }), /at least one/);
  await assert.rejects(api.changeProjectColumn('PVT_1', { id: 'missing', remove: true }), /no longer exists/);
});

test('invalid draft titles and column directions never make a request', async () => {
  const api = client(async () => assert.fail('Unexpected request'));
  await assert.rejects(api.createProjectDraft('PVT_1', { title: ' ' }), /title is required/);
  await assert.rejects(api.updateProjectDraft('DRAFT_1', { title: '' }), /title is required/);
  await assert.rejects(api.changeProjectColumn('PVT_1', { id: 'todo', direction: 5 }), /direction/);
  await assert.rejects(api.changeProjectColumn('PVT_1', { remove: true }), /Choose a status/);
});

test('card topic edits use the repo credential and retain the chat prefix', async () => {
  const api = client(async (url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer repo-token');
    if (request.method === 'PATCH') assert.deepEqual(JSON.parse(request.body), { title: '💬 Renamed', body: 'Description' });
    return Response.json({ number: 1, title: '💬 Renamed', state: 'open', body: 'Description' });
  });
  assert.equal((await api.updateChannelDetails(1, { name: 'Renamed', description: 'Description' })).name, 'Renamed');
});

test('stale polls cannot restore a removed card or overwrite an edited draft', () => {
  const tracker = createProjectTracker();
  tracker.remove('gone');
  assert.deepEqual(tracker.reconcile([{ id: 'gone' }]), []);
  tracker.remember({ id: 'draft', title: 'Updated', body: 'Details', statusId: 'todo' }, false, ['title', 'body']);
  assert.equal(tracker.reconcile([{ id: 'draft', title: 'Old', body: '', statusId: 'todo' }])[0].title, 'Updated');
  assert.equal(tracker.reconcile([{ id: 'draft', title: 'Updated', body: 'Details', statusId: 'todo' }])[0].syncState, undefined);
});

test('column confirmation compares names, details, colors, and order', () => {
  assert.equal(sameProjectColumns(field, { ...field }), true);
  assert.equal(sameProjectColumns(field, { ...field, options: [...options].reverse() }), false);
  assert.equal(sameProjectColumns(field, { ...field, options: [{ ...options[0], name: 'Renamed' }, options[1]] }), false);
});
