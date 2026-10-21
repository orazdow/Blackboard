import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGitHubClient, GitHubError } from '../src/api.js';

const issue = (number, extra = {}) => ({
  number, node_id: `I_${number}`, title: `💬 channel-${number}`, body: 'Topic description',
  state: 'open', html_url: `https://github.com/example/chat/issues/${number}`, ...extra,
});
const comment = (id) => ({ id, user: { login: 'agent' }, body: 'Hello', created_at: '2026-10-20T19:00:00Z', html_url: 'https://github.com/example/chat' });
const client = (fetch, extra = {}) => createGitHubClient({ token: 'test-token', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0, ...extra });

test('reaction ownership uses the authenticated viewer and caches that identity', async () => {
  let calls = 0;
  const api = client(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return Response.json({ login: 'viewer' });
  });
  assert.deepEqual(await Promise.all([api.getViewer(), api.getViewer()]), ['viewer', 'viewer']);
  assert.equal(await api.getViewer(), 'viewer');
  assert.equal(calls, 1);
});

test('reaction listing follows pagination and preserves individual ownership', async () => {
  let calls = 0;
  const api = client(async (url) => {
    calls++;
    assert.match(url, /\/issues\/comments\/7\/reactions\?/);
    return Response.json([{ id: calls, content: 'heart', user: { login: calls === 1 ? 'viewer' : 'other' } }], {
      headers: calls === 1 ? { link: '<https://api.github.com/repos/example/chat/issues/comments/7/reactions?per_page=100&page=2>; rel="next"' } : {},
    });
  });
  assert.deepEqual(await api.listReactions(7), [
    { id: 1, type: 'heart', author: 'viewer' },
    { id: 2, type: 'heart', author: 'other' },
  ]);
});

test('adds an emoji reaction and deletes the specified reaction', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ id: 42, content: 'heart', user: { login: 'viewer' } }, { status: 201 });
  });
  assert.deepEqual(await api.addReaction(7, 'heart'), { id: 42, type: 'heart', author: 'viewer' });
  await api.removeReaction(7, 42);
  assert.equal(calls[0].url, 'https://api.github.com/repos/example/chat/issues/comments/7/reactions');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { content: 'heart' });
  assert.equal(calls[1].url, `${calls[0].url}/42`);
  assert.equal(calls[1].options.method, 'DELETE');
});

test('invalid reactions cannot issue requests', async () => {
  const api = client(async () => assert.fail('Unexpected request'));
  await assert.rejects(api.addReaction(7, 'unknown'), /Unsupported reaction/);
  await assert.rejects(api.listReactions(0), /Invalid comment/);
  await assert.rejects(api.addReaction(-1, 'heart'), /Invalid comment/);
  await assert.rejects(api.removeReaction(7, 0), /Invalid reaction/);
});

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
      : [issue(101), issue(102, { title: 'Other issue' }), issue(103, { pull_request: {} })], {
        headers: calls.length === 1 ? { link: '<https://api.github.com/repos/example/chat/issues?state=open&per_page=100&page=2>; rel="next"' } : {},
      });
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
    ? Array.from({ length: 100 }, (_, i) => comment(i + 1)) : [comment(101)], {
      headers: calls === 1 ? { link: '<https://api.github.com/repos/example/chat/issues/2/comments?per_page=100&page=2>; rel="next"' } : {},
    }));
  const messages = await api.readMessages(2);
  assert.equal(messages.length, 101);
  assert.equal(messages[100].id, 101);
});

test('messages expose each present reaction once, without counts', async () => {
  const api = client(async () => Response.json([
    { ...comment(1), reactions: { '+1': 5, '-1': 0, laugh: 2, confused: 0, heart: 1, hooray: 0, rocket: 3, eyes: 0, total_count: 11 } },
    comment(2),
  ]));
  const messages = await api.readMessages(1);
  assert.deepEqual(messages[0].reactions, ['+1', 'laugh', 'heart', 'rocket']);
  assert.deepEqual(messages[1].reactions, []);
});

test('polling reflects added and removed reactions on an existing comment', async () => {
  let calls = 0;
  const api = client(async () => Response.json([
    { ...comment(1), reactions: ++calls === 1 ? { heart: 2 } : { heart: 0, eyes: 1 } },
  ]));
  assert.deepEqual((await api.readMessages(1))[0].reactions, ['heart']);
  assert.deepEqual((await api.readMessages(1))[0].reactions, ['eyes']);
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
  await assert.rejects(client(fetch, { token: '' }).listChannels(), /Permit this repository/);
  await assert.rejects(client(fetch).sendMessage(-1, 'Hello'), /Invalid channel ID/);
});

test('conditional polling sends ETags and reuses data after 304', async () => {
  let calls = 0;
  const api = client(async (url, options) => {
    if (++calls === 1) return Response.json([comment(1)], { headers: { etag: '"v1"' } });
    assert.equal(options.headers['If-None-Match'], '"v1"');
    return new Response(null, { status: 304 });
  });
  const first = await api.readMessages(1);
  assert.deepEqual(await api.readMessages(1), first);
  assert.equal(calls, 2);
});

test('uses Last-Modified when no ETag is supplied', async () => {
  let calls = 0;
  const modified = 'Wed, 21 Oct 2026 01:00:00 GMT';
  const api = client(async (url, options) => {
    if (++calls === 1) return Response.json([], { headers: { 'last-modified': modified } });
    assert.equal(options.headers['If-Modified-Since'], modified);
    return new Response(null, { status: 304 });
  });
  await api.readMessages(1);
  assert.deepEqual(await api.readMessages(1), []);
});

test('unchanged pages retain pagination links across 304 responses', async () => {
  let calls = 0;
  const api = client(async (url) => {
    calls++;
    if (calls > 2) return new Response(null, { status: 304 });
    const firstPage = new URL(url).searchParams.get('page') === '1';
    return Response.json([comment(firstPage ? 1 : 2)], { headers: {
      etag: firstPage ? '"p1"' : '"p2"',
      ...(firstPage ? { link: '<https://api.github.com/repos/example/chat/issues/1/comments?per_page=100&page=2>; rel="next"' } : {}),
    } });
  });
  assert.deepEqual((await api.readMessages(1)).map((item) => item.id), [1, 2]);
  assert.deepEqual((await api.readMessages(1)).map((item) => item.id), [1, 2]);
  assert.equal(calls, 4);
});

test('honors x-poll-interval and invalidates cached reads after writes', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push(options);
    if (options.method === 'POST') return Response.json(comment(2));
    return Response.json([comment(calls.length === 1 ? 1 : 2)], { headers: { etag: '"v1"', 'x-poll-interval': '60' } });
  });
  await api.readMessages(1);
  await api.readMessages(1);
  assert.equal(calls.length, 1);
  await api.sendMessage(1, 'Hello');
  const latest = await api.readMessages(1);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].headers['If-None-Match'], undefined);
  assert.equal(latest[0].id, 2);
});

test('coalesces concurrent identical reads and serializes other requests', async () => {
  let active = 0;
  let calls = 0;
  const api = client(async () => {
    calls++;
    assert.equal(++active, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return Response.json([]);
  });
  await Promise.all([api.readMessages(1), api.readMessages(1), api.readMessages(2)]);
  assert.equal(calls, 2);
});

test('pagination accepts repository name casing but rejects external URLs', async () => {
  let calls = 0;
  const api = client(async () => Response.json([comment(++calls)], { headers: calls === 1
    ? { link: '<https://api.github.com/repos/Example/Chat/issues/1/comments?per_page=100&page=2>; rel="next"' } : {},
  }));
  assert.equal((await api.readMessages(1)).length, 2);
  let externalCalls = 0;
  const external = client(async () => {
    externalCalls++;
    return Response.json([], { headers: { link: '<https://example.com/comments>; rel="next"' } });
  });
  await assert.rejects(external.readMessages(1), /unexpected pagination URL/);
  assert.equal(externalCalls, 1);
});

test('numeric repository pagination retains cursor queries and stays on the configured repository', async () => {
  const calls = [];
  const api = client(async (url) => {
    calls.push(url);
    return Response.json([comment(calls.length)], { headers: calls.length === 1
      ? { link: '<https://api.github.com/repositories/123/issues/1/comments?per_page=100&after=opaque%3D&page=2>; rel="next"' } : {} });
  });
  assert.deepEqual((await api.readMessages(1)).map((entry) => entry.id), [1, 2]);
  assert.equal(calls[1], 'https://api.github.com/repos/example/chat/issues/1/comments?per_page=100&after=opaque%3D&page=2');
});

test('pagination cannot switch to another repository name or a different endpoint', async () => {
  for (const next of ['https://api.github.com/repos/other/repo/issues/1/comments?page=2', 'https://api.github.com/repositories/123/issues/2/comments?page=2']) {
    let calls = 0;
    const api = client(async () => { calls++; return Response.json([], { headers: { link: `<${next}>; rel="next"` } }); });
    await assert.rejects(api.readMessages(1), /unexpected pagination URL/);
    assert.equal(calls, 1);
  }
});

test('stops on secondary rate-limit responses without retrying', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return Response.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 });
  });
  await assert.rejects(api.listChannels(), (failure) => failure.retryAt > Date.now());
  await assert.rejects(api.listChannels(), /Waiting/);
  assert.equal(calls, 1);
});
