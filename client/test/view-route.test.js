import test from 'node:test';
import assert from 'node:assert/strict';
import { readView, urlForView } from '../src/view-route.js';

test('topic view URLs preserve the repository and other query parameters', () => {
  const initial = 'https://orazdow.github.io/Blackboard/?repo=orazdow%2FApplications&theme=blue';
  const next = urlForView(initial, { kind: 'topic', id: 12 });
  assert.equal(next.searchParams.get('repo'), 'orazdow/Applications');
  assert.equal(next.searchParams.get('theme'), 'blue');
  assert.deepEqual(readView(next.href), { kind: 'topic', id: 12 });
});

test('goals and discussion topics have restorable view IDs', () => {
  const base = 'https://example.com/client';
  for (const view of [
    { kind: 'goal', id: 3 },
    { kind: 'topic', id: 'discussion:D_kwDOA=' },
  ]) assert.deepEqual(readView(urlForView(base, view).href), view);
});

test('invalid view parameters are ignored', () => {
  const base = 'https://example.com/client?view=';
  for (const value of ['topic:0', 'topic:abc', 'goal:-1', 'project:PVT_kwHOA', 'other:12']) {
    assert.equal(readView(`${base}${encodeURIComponent(value)}`), null);
  }
});
