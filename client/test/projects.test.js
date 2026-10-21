import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/api.js';
import { boardColumns, createProjectTracker, previewBoard } from '../src/project-state.js';

const client = (fetch) => createGitHubClient({ token: 'repo-token', projectToken: 'project-token', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0 });
const connection = (nodes, endCursor = null) => ({ nodes, pageInfo: { hasNextPage: Boolean(endCursor), endCursor } });
const project = { id: 'PVT_1', number: 1, title: 'School', url: 'https://github.com/users/example/projects/1', closed: false, viewerCanUpdate: true };
const status = { __typename: 'ProjectV2SingleSelectField', id: 'FIELD_1', name: 'Status', options: [{ id: 'todo', name: 'Todo' }, { id: 'done', name: 'Done' }] };
const item = (id, extra = {}) => ({ id, isArchived: false, fieldValueByName: { optionId: 'todo' }, content: { __typename: 'Issue', id: 'ISSUE_1', number: 1, title: '💬 Topic', state: 'OPEN', url: 'https://github.com/example/chat/issues/1', repository: { nameWithOwner: 'example/chat' } }, ...extra });

test('project listing paginates and uses only the Projects credential', async () => {
  const api = client(async (url, options) => {
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(options.headers.Authorization, 'Bearer project-token');
    const { variables } = JSON.parse(options.body);
    assert.equal(variables.owner, 'example');
    assert.equal(variables.repo, 'chat');
    return Response.json({ data: { repository: { projectsV2: variables.after ? connection([{ ...project, id: 'PVT_2', number: 2 }]) : connection([project], 'next') } } });
  });
  assert.deepEqual((await api.listProjects()).map((entry) => entry.id), ['PVT_1', 'PVT_2']);
});

test('project reads paginate fields and cards, filter archived cards, and identify only local chat topics', async () => {
  const api = client(async (url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('BlackboardProjectFields')) return Response.json({ data: { node: { ...project, fields: variables.after ? connection([status]) : connection([{ __typename: 'ProjectV2Field' }], 'fields-next') } } });
    assert.equal(variables.statusName, 'Status');
    return Response.json({ data: { node: { items: variables.after
      ? connection([item('ITEM_2', { content: { ...item('x').content, repository: { nameWithOwner: 'example/other' } } }), item('ITEM_3', { content: null })])
      : connection([item('ITEM_1'), item('ARCHIVED', { isArchived: true })], 'items-next') } } });
  });
  const board = await api.readProject('PVT_1');
  assert.equal(board.name, 'School');
  assert.equal(board.statusField.id, 'FIELD_1');
  assert.equal(board.items.length, 3);
  assert.equal(board.items[0].title, 'Topic');
  assert.equal(board.items[0].channelId, 1);
  assert.equal(board.items[1].channelId, null);
  assert.equal(board.items[2].title, 'Unavailable item');
});

test('moving a card updates only its project field, and No status clears the field', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    assert.equal(url, 'https://api.github.com/graphql');
    const body = JSON.parse(options.body);
    calls.push(body);
    const name = body.query.includes('BlackboardClearStatus') ? 'clearProjectV2ItemFieldValue' : 'updateProjectV2ItemFieldValue';
    return Response.json({ data: { [name]: { projectV2Item: { id: 'ITEM_1' } } } });
  });
  await api.setProjectItemStatus('PVT_1', 'ITEM_1', 'FIELD_1', 'done');
  await api.setProjectItemStatus('PVT_1', 'ITEM_1', 'FIELD_1', null);
  assert.deepEqual(calls[0].variables, { project: 'PVT_1', item: 'ITEM_1', field: 'FIELD_1', option: 'done' });
  assert.deepEqual(calls[1].variables, { project: 'PVT_1', item: 'ITEM_1', field: 'FIELD_1' });
  assert.ok(calls.every((call) => !call.query.includes('closeIssue')));
});

test('adding a topic reads with the repo token and adds its node ID with the Projects token', async () => {
  const api = client(async (url, options) => {
    if (url.endsWith('/issues/1')) {
      assert.equal(options.headers.Authorization, 'Bearer repo-token');
      return Response.json({ number: 1, node_id: 'ISSUE_1', title: '💬 Topic', state: 'open' });
    }
    assert.equal(options.headers.Authorization, 'Bearer project-token');
    assert.deepEqual(JSON.parse(options.body).variables, { project: 'PVT_1', content: 'ISSUE_1' });
    return Response.json({ data: { addProjectV2ItemById: { item: { id: 'ITEM_1' } } } });
  });
  const added = await api.addTopicToProject('PVT_1', 1);
  assert.equal(added.id, 'ITEM_1');
  assert.equal(added.channelId, 1);
});

test('project reads fail as reads, while uncertain writes are never automatically retried', async () => {
  let calls = 0;
  const api = client(async () => { calls++; throw new TypeError('Disconnected'); });
  await assert.rejects(api.listProjects(), (error) => !error.uncertain);
  await assert.rejects(api.setProjectItemStatus('PVT_1', 'ITEM_1', 'FIELD_1', 'done'), (error) => error.uncertain);
  assert.equal(calls, 2);
});

test('GraphQL forbidden results are visible instead of being treated as an empty project list', async () => {
  const api = client(async () => Response.json({ data: { repository: null }, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }] }));
  await assert.rejects(api.listProjects(), (error) => error.status === 403 && !error.uncertain);
});

test('repeated project cursors and invalid identifiers fail safely', async () => {
  const api = client(async () => Response.json({ data: { repository: { projectsV2: connection([], 'same') } } }));
  await assert.rejects(api.listProjects(), /repeated project pagination/);
  const noRequests = client(async () => assert.fail('Unexpected request'));
  await assert.rejects(noRequests.readProject('bad id'), /Invalid project identifier/);
});

test('missing mutation acknowledgement is uncertain, rather than reporting success', async () => {
  const api = client(async () => Response.json({ data: {} }));
  await assert.rejects(api.setProjectItemStatus('PVT_1', 'ITEM_1', 'FIELD_1', 'done'), (error) => error.uncertain);
});

test('board grouping retains all cards and filters by title or repository', () => {
  const board = { statusField: status, items: [{ id: '1', title: 'Build', statusId: 'todo', repository: 'example/chat' }, { id: '2', title: 'Unknown option', statusId: 'removed' }, { id: '3', title: 'Finished', statusId: 'done' }] };
  assert.deepEqual(boardColumns(board).map((column) => column.items.map((entry) => entry.id)), [['2'], ['1'], ['3']]);
  assert.equal(boardColumns(board, 'EXAMPLE/CHAT').find((column) => column.id === 'todo').items.length, 1);
  assert.equal(boardColumns(board, 'Finished').find((column) => column.id === 'done').items.length, 1);
});

test('No status is hidden when empty and appears when a card needs it', () => {
  const board = { statusField: status, items: [] };
  assert.deepEqual(boardColumns(board).map((column) => column.id), ['todo', 'done']);
  board.items.push({ id: '1', title: 'Unassigned', statusId: null });
  assert.deepEqual(boardColumns(board).map((column) => column.id), [null, 'todo', 'done']);
});

test('local project changes stay visible through stale reads and additions accept automated status changes', () => {
  const tracker = createProjectTracker();
  tracker.remember({ id: '1', title: 'Moved', statusId: 'done' });
  assert.equal(tracker.reconcile([{ id: '1', statusId: 'todo' }])[0].statusId, 'done');
  assert.equal(tracker.reconcile([{ id: '1', statusId: 'done' }])[0].syncState, undefined);
  tracker.remember({ id: '2', title: 'Added', statusId: null }, true);
  assert.equal(tracker.reconcile([]).find((item) => item.id === '2').syncState, 'confirming');
  assert.equal(tracker.reconcile([{ id: '2', statusId: 'todo' }]).find((item) => item.id === '2').statusId, 'todo');
});

test('preview boards are explicitly local and never editable through project API controls', () => {
  const board = previewBoard([{ id: 1, name: 'Topic', state: 'open' }]);
  assert.equal(board.canUpdate, false);
  assert.equal(board.items[0].channelId, 1);
  assert.match(board.description, /No project changes are saved/);
});
