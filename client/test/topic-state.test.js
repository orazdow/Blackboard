import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopicTracker } from '../src/topic-state.js';

const topic = (id, extra = {}) => ({ id, name: 'Hippos', state: 'open', archived: false, ...extra });

test('new topic stays dimmed through stale polls until GitHub lists it', () => {
  const tracker = createTopicTracker();
  const created = tracker.remember(topic(2));
  assert.equal(created.syncState, 'confirming');
  assert.deepEqual(tracker.reconcile([topic(1)]).map((item) => item.id), [1, 2]);
  assert.equal(tracker.reconcile([topic(1)])[1].syncState, 'confirming');
  const confirmed = tracker.reconcile([topic(1), topic(2)]);
  assert.equal(confirmed[1].syncState, undefined);
  // Once observed, subsequent real remote removals are respected.
  assert.deepEqual(tracker.reconcile([topic(1)]).map((item) => item.id), [1]);
});

test('a stale poll cannot undo a confirmed close', () => {
  const tracker = createTopicTracker();
  tracker.remember(topic(2, { state: 'closed' }));
  assert.equal(tracker.reconcile([topic(2)])[0].state, 'closed');
  assert.equal(tracker.reconcile([topic(2, { state: 'closed' })])[0].syncState, undefined);
});

test('archiving a new topic before its first poll never reveals it again', () => {
  const tracker = createTopicTracker();
  tracker.remember(topic(2));
  tracker.remember(topic(2, { archived: true }));
  assert.deepEqual(tracker.reconcile([topic(2)]).filter((item) => !item.archived), []);
  assert.equal(tracker.reconcile([topic(2, { archived: true })])[0].syncState, undefined);
});

test('deleting a new topic cancels its overlay and suppresses stale list entries', () => {
  const tracker = createTopicTracker();
  tracker.remember(topic(2));
  tracker.remove(2);
  assert.deepEqual(tracker.reconcile([topic(2)]), []);
  assert.deepEqual(tracker.reconcile([]), []);
});
