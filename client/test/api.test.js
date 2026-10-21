import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGitHubClient, GitHubError } from '../src/api.js';

const issue = (number, extra = {}) => ({
  number, title: `💬 channel-${number}`, body: 'Topic description',
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

test('message snapshots include every page', async () => {
  let calls = 0;
  const api = client(async () => Response.json(++calls === 1
    ? Array.from({ length: 100 }, (_, i) => comment(i + 1)) : [comment(101)]));
  const messages = await api.readMessages(2);
  assert.equal(messages.length, 101);
  assert.equal(messages[100].id, 101);
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
