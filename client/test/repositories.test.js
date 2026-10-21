import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/api.js';
import { parseRepository } from '../src/repository-state.js';

test('repository input accepts owner/repo and GitHub clone URLs', () => {
  for (const value of [' Alice/Board ', 'https://github.com/Alice/Board', 'https://github.com/Alice/Board/', 'https://github.com/Alice/Board.git']) {
    assert.deepEqual(parseRepository(value), { owner: 'Alice', repo: 'Board' });
  }
});

test('repository input rejects foreign hosts, credentials, traversal, and non-repository URLs', () => {
  for (const value of ['', 'Board', 'Alice/Board/issues', 'Alice/..', 'https://example.com/Alice/Board', 'https://github.com.evil.test/Alice/Board', 'https://token@github.com/Alice/Board', 'https://github.com/Alice/Board?token=secret', 'https://github.com:444/Alice/Board']) {
    assert.throws(() => parseRepository(value), /repository URL or owner\/repo/);
  }
});

const client = (owner, repo, fetch) => createGitHubClient({ owner, repo, token: 'repo-token', projectToken: 'project-token', fetch, minWriteInterval: 0 });

test('connection verifies repository and issue access without any write and uses canonical owner/name', async () => {
  const paths = [];
  const api = client('alias', 'board', async (url, request) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.Authorization, 'Bearer repo-token');
    paths.push(url);
    return Response.json(url.endsWith('/board')
      ? { owner: { login: 'Alice' }, name: 'Board', has_issues: true }
      : []);
  });
  assert.deepEqual(await api.checkRepository(), { owner: 'Alice', repo: 'Board' });
  assert.deepEqual(paths, ['https://api.github.com/repos/alias/board', 'https://api.github.com/repos/alias/board/issues?state=open&per_page=1']);
});

test('connection rejects a visible repository if Issues access is missing', async () => {
  const api = client('Alice', 'Board', async (url) => url.endsWith('/Board')
    ? Response.json({ owner: { login: 'Alice' }, name: 'Board', has_issues: true })
    : Response.json({ message: 'Resource not accessible by personal access token' }, { status: 403 }));
  await assert.rejects(api.checkRepository(), (failure) => failure.status === 403);
});

test('connection accepts GitHub’s numeric repository pagination URL when the repository has issues', async () => {
  const api = client('Alice', 'Board', async (url) => url.endsWith('/Board')
    ? Response.json({ owner: { login: 'Alice' }, name: 'Board', has_issues: true })
    : Response.json([{ number: 1 }], { headers: { link: '<https://api.github.com/repositories/123/issues?state=open&per_page=1&after=cursor&page=2>; rel="next"' } }));
  assert.deepEqual(await api.checkRepository(), { owner: 'Alice', repo: 'Board' });
});

test('connection explains disabled Issues before attempting to list topics', async () => {
  let requests = 0;
  const api = client('Alice', 'Board', async () => { requests++; return Response.json({ owner: { login: 'Alice' }, name: 'Board', has_issues: false }); });
  await assert.rejects(api.checkRepository(), /Enable Issues/);
  assert.equal(requests, 1);
});

test('clients for separate repositories cannot reuse each other’s cached issue numbers', async () => {
  const paths = [];
  const fetch = async (url) => {
    paths.push(url);
    return Response.json([{ id: url.includes('/First/') ? 1 : 2, body: 'Message', created_at: '2026-10-21T12:00:00Z', user: { login: 'Alice' } }]);
  };
  const first = client('Alice', 'First', fetch);
  const second = client('Alice', 'Second', fetch);
  assert.equal((await first.readMessages(1))[0].id, 1);
  assert.equal((await second.readMessages(1))[0].id, 2);
  assert.equal(paths.length, 2);
});
