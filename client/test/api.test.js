import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGitHubClient, GitHubError } from '../src/api.js';

const issue = (number, extra = {}) => ({
  number, node_id: `I_${number}`, title: `💬 channel-${number}`, body: 'Topic description',
  state: 'open', html_url: `https://github.com/example/chat/issues/${number}`, ...extra,
});
const comment = (id) => ({ id, user: { login: 'agent' }, body: 'Hello', created_at: '2026-10-20T19:00:00Z', html_url: 'https://github.com/example/chat' });
const client = (fetch, extra = {}) => createGitHubClient({ token: 'test-token', owner: 'example', repo: 'chat', fetch, ...extra });

test('sender metadata round trips without changing the GitHub author', async () => {
  const api = client(async (url, options) => {
    const { body } = JSON.parse(options.body);
    assert.equal(body, '_@dot\nHello');
    return Response.json({ ...comment(1), body });
  });
  const sent = await api.sendMessage(1, 'Hello', { sender: 'dot' });
  assert.equal(sent.sender, 'dot');
  assert.equal(sent.author, 'agent');
  assert.equal(sent.text, 'Hello');
});

test('shared metadata examples decode consistently', async () => {
  const examples = JSON.parse(readFileSync(new URL('./message-metadata.json', import.meta.url), 'utf8'));
  const api = client(async () => Response.json(examples.map((item, index) => ({ ...comment(index + 1), body: item.body }))));
  const messages = await api.readMessages(1);
  examples.forEach((item, index) => {
    assert.equal(messages[index].sender, item.sender);
    assert.equal(messages[index].text, item.text);
    assert.equal(messages[index].author, 'agent');
  });
});

test('invalid sender names fail before making a request', async () => {
  const api = client(async () => assert.fail('Unexpected request'));
  for (const sender of ['', 'Dot', 'dot\n', 'a'.repeat(65), 42]) {
    await assert.rejects(api.sendMessage(1, 'Hello', { sender }), /Sender must/);
  }
});

test('lists all pages and excludes unrelated issues and pull requests', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return Response.json(calls.length === 1
      ? Array.from({ length: 100 }, (_, i) => issue(i + 1))
      : [issue(101), issue(102, { title: 'Other issue' }), issue(103, { pull_request: {} })]);
  });
  const channels = await api.listChannels();
  assert.equal(channels.length, 101);
  assert.equal(channels[0].id, 1);
  assert.equal(channels[0].name, 'channel-1');
  assert.match(calls[1], /page=2/);
});

test('creates prefixed channels, posts comments, and closes without deleting', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json(url.endsWith('/comments') ? comment(7) : issue(3));
  });
  await api.createChannel({ name: ' general ', topic: 'Welcome' });
  const sent = await api.sendMessage(3, 'Hello');
  await api.closeChannel(3);
  assert.deepEqual(calls[0].body, { title: '💬 general', body: 'Welcome' });
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(calls[1].body, { body: 'Hello' });
  assert.equal(sent.author, 'agent');
  assert.ok(sent.time instanceof Date);
  assert.equal(calls[2].method, 'PATCH');
  assert.equal(calls[2].body.state, 'closed');
  assert.equal(calls[2].body.state_reason, 'not_planned');
});

test('includes archived topics on request and reopens an issue', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(options.method === 'PATCH'
      ? issue(3, { state: 'open' })
      : [issue(3, { state: 'closed' })]);
  });
  const channels = await api.listChannels({ includeClosed: true });
  assert.match(calls[0].url, /state=all/);
  assert.equal(channels[0].state, 'closed');
  const reopened = await api.reopenChannel(3);
  assert.equal(calls[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].body), { state: 'open' });
  assert.equal(reopened.state, 'open');
});

test('message snapshots include every page', async () => {
  let calls = 0;
  const api = client(async () => Response.json(++calls === 1
    ? Array.from({ length: 100 }, (_, i) => comment(i + 1)) : [comment(101)]));
  const messages = await api.readMessages(2);
  assert.equal(messages.length, 101);
  assert.equal(messages[100].id, 101);
});

test('archived topics are hidden by default independently of open/closed state', async () => {
  const api = client(async () => Response.json([
    issue(1), issue(2, { labels: [{ name: 'blackboard:archived' }] }),
    issue(3, { state: 'closed', labels: ['blackboard:archived'] }),
  ]));
  assert.deepEqual((await api.listChannels({ includeClosed: true })).map((item) => item.id), [1]);
  const all = await api.listChannels({ includeClosed: true, includeArchived: true });
  assert.equal(all.length, 3);
  assert.equal(all[1].archived, true);
  assert.equal(all[1].state, 'open');
});

test('archiving adds a label without replacing existing labels or closing the issue', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(options.method === 'GET' ? { name: 'blackboard:archived' } : [{ name: 'blackboard:archived' }]);
  });
  assert.deepEqual(await api.archiveChannel(3), { id: 3, archived: true });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/issues\/3\/labels$/);
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body), { labels: ['blackboard:archived'] });
});

test('archiving creates the repository label if missing', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options });
    if (calls.length === 1) return Response.json({ message: 'Not Found' }, { status: 404 });
    return Response.json({ name: 'blackboard:archived' });
  });
  await api.archiveChannel(3);
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /\/labels$/);
  assert.equal(JSON.parse(calls[1].body).name, 'blackboard:archived');
  assert.match(calls[2].url, /\/issues\/3\/labels$/);
});

test('deletion uses the issue node ID and a GraphQL mutation, never close', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(calls.length === 1 ? issue(3) : { data: { deleteIssue: { repository: { id: 'R_1' } } } });
  });
  assert.deepEqual(await api.deleteChannel(3), { id: 3, deleted: true });
  assert.equal(calls[1].url, 'https://api.github.com/graphql');
  assert.equal(calls[1].method, 'POST');
  const body = JSON.parse(calls[1].body);
  assert.equal(body.variables.id, 'I_3');
  assert.match(body.query, /deleteIssue/);
});

test('GraphQL deletion errors do not report success', async () => {
  let calls = 0;
  const api = client(async () => Response.json(++calls === 1 ? issue(3) : {
    errors: [{ type: 'FORBIDDEN', message: 'Insufficient permissions' }], data: { deleteIssue: null },
  }));
  await assert.rejects(api.deleteChannel(3), /Insufficient permissions/);
  assert.equal(calls, 2);
});

test('deletion refuses non-topics and never retries an uncertain mutation', async () => {
  let calls = 0;
  const unrelated = client(async () => { calls++; return Response.json(issue(3, { title: 'Other issue' })); });
  await assert.rejects(unrelated.deleteChannel(3), /Only Blackboard/);
  assert.equal(calls, 1);
  calls = 0;
  const timeout = client(async () => {
    if (++calls === 1) return Response.json(issue(3));
    throw new TypeError('Network error');
  });
  await assert.rejects(timeout.deleteChannel(3), (failure) => failure.uncertain);
  assert.equal(calls, 2);
});

test('network write failures are uncertain and never automatically retried', async () => {
  let calls = 0;
  const api = client(async () => { calls++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.sendMessage(1, 'Hello'), (error) => error instanceof GitHubError && error.uncertain);
  assert.equal(calls, 1);
  await assert.rejects(api.listChannels(), (error) => !error.uncertain);
});

test('permission failures are definite, while server write failures are uncertain', async () => {
  for (const status of [403, 500]) {
    const api = client(async () => Response.json({ message: 'Request failed' }, { status }));
    await assert.rejects(api.sendMessage(1, 'Hello'), (error) => error.status === status && error.uncertain === (status === 500));
  }
});

test('honors rate-limit resets without repeatedly calling GitHub', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return Response.json({ message: 'API rate limit exceeded' }, {
      status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 120) },
    });
  });
  await assert.rejects(api.listChannels(), (error) => error.retryAt > Date.now());
  await assert.rejects(api.listChannels(), (error) => error.retryAt > Date.now());
  assert.equal(calls, 1);
});

test('missing credentials and invalid channel IDs fail before fetching', async () => {
  const fetch = async () => assert.fail('Unexpected network call');
  await assert.rejects(client(fetch, { token: '' }).listChannels(), /Fill in/);
  await assert.rejects(client(fetch).sendMessage(-1, 'Hello'), /Invalid channel ID/);
});
