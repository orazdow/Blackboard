import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/api.js';

const client = (fetch) => createGitHubClient({ token: 'issue-token', projectToken: 'project-token', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0 });
const view = { id: 'VIEW_1', number: 1, name: 'Open work', layout: 'TABLE_LAYOUT', filter: 'is:open' };
const connection = (nodes, next = null) => ({ nodes, pageInfo: { hasNextPage: Boolean(next), endCursor: next } });

test('saved views paginate using the project credential and retain Roadmap metadata', async () => {
  const api = client(async (url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer project-token');
    const { variables } = JSON.parse(request.body);
    return Response.json({ data: { node: { views: variables.after
      ? connection([{ ...view, id: 'VIEW_2', layout: 'ROADMAP_LAYOUT' }])
      : connection([view], 'next') } } });
  });
  const views = await api.listProjectViews('PROJECT_1');
  assert.equal(views.length, 2);
  assert.equal(views[0].filter, 'is:open');
  assert.equal(views[1].layout, 'ROADMAP_LAYOUT');
});

test('view filters are passed verbatim to GitHub and matching IDs paginate, omitting archived items', async () => {
  const filter = 'status:"In progress" -label:blocked';
  const api = client(async (url, request) => {
    const { query, variables } = JSON.parse(request.body);
    assert.ok(query.includes('query:$filter'));
    assert.equal(variables.filter, filter);
    return Response.json({ data: { node: { items: variables.after
      ? connection([{ id: 'ITEM_2', isArchived: false }])
      : connection([{ id: 'ITEM_1' }, { id: 'ARCHIVED', isArchived: true }], 'next') } } });
  });
  assert.deepEqual(await api.projectViewItemIds('PROJECT_1', filter), ['ITEM_1', 'ITEM_2']);
});

test('new view creation saves its filter in a second mutation without creating project items', async () => {
  const calls = [];
  const api = client(async (url, request) => {
    const body = JSON.parse(request.body); calls.push(body);
    assert.ok(!body.query.includes('addProjectV2Item'));
    if (calls.length === 1) {
      assert.deepEqual(body.variables, { project: 'PROJECT_1', name: 'Open work', layout: 'TABLE_LAYOUT' });
      return Response.json({ data: { createProjectV2View: { projectV2View: { ...view, filter: '' } } } });
    }
    assert.deepEqual(body.variables, { input: { viewId: 'VIEW_1', filter: 'is:open' } });
    return Response.json({ data: { updateProjectV2View: { projectV2View: view } } });
  });
  assert.deepEqual(await api.createProjectView('PROJECT_1', { name: ' Open work ', layout: 'TABLE_LAYOUT', filter: 'is:open' }), view);
  assert.equal(calls.length, 2);
});

test('failed filter setup retains the created view so the client can edit instead of duplicating it', async () => {
  let creates = 0;
  const api = client(async (url, request) => {
    const { query } = JSON.parse(request.body);
    if (query.includes('BlackboardCreateView')) {
      creates++;
      return Response.json({ data: { createProjectV2View: { projectV2View: { ...view, filter: '' } } } });
    }
    return Response.json({ errors: [{ type: 'FORBIDDEN', message: 'Denied' }] });
  });
  await assert.rejects(api.createProjectView('PROJECT_1', { name: view.name, filter: 'is:open' }), (failure) => failure.createdView.id === view.id);
  assert.equal(creates, 1);
});

test('editing a view clears filters explicitly and leaves unrelated configuration untouched', async () => {
  const api = client(async (url, request) => {
    const { variables } = JSON.parse(request.body);
    assert.deepEqual(variables.input, { viewId: 'VIEW_1', name: 'All items', layout: 'BOARD_LAYOUT', filter: '' });
    return Response.json({ data: { updateProjectV2View: { projectV2View: { ...view, ...variables.input } } } });
  });
  assert.equal((await api.updateProjectView('VIEW_1', { name: 'All items', layout: 'BOARD_LAYOUT', filter: '' })).filter, '');
});

test('view deletion targets only the view and requires an acknowledgement', async () => {
  let calls = 0;
  const api = client(async (url, request) => {
    calls++;
    const { query, variables } = JSON.parse(request.body);
    assert.ok(query.includes('deleteProjectV2View('));
    assert.ok(!query.includes('deleteProjectV2Item('));
    assert.deepEqual(variables, { id: 'VIEW_1' });
    return Response.json({ data: {} });
  });
  await assert.rejects(api.deleteProjectView('VIEW_1'), (failure) => failure.uncertain);
  assert.equal(calls, 1);
});

test('unsupported creation layouts fail before making a request', async () => {
  const api = client(() => { throw new Error('Unexpected request'); });
  await assert.rejects(api.createProjectView('PROJECT_1', { name: 'Roadmap', layout: 'ROADMAP_LAYOUT' }), /Board or Table/);
});
