import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/api.js';
import { createTopicTracker } from '../src/topic-state.js';

const label = (name, extra = {}) => ({ name, color: '52769b', description: '', ...extra });
const issue = (extra = {}) => ({ number: 1, title: '💬 Topic', state: 'open', labels: [], sub_issues_summary: { total: 0 }, ...extra });
const client = (fetch) => createGitHubClient({ token: 'test', owner: 'example', repo: 'chat', fetch, minWriteInterval: 0 });

test('suggestions paginate through usage, deduplicate names, and omit internal and archived labels', async () => {
  let calls = 0;
  const api = client(async (url) => {
    assert.match(url, /\/issues\?state=all/);
    return Response.json(++calls === 1
      ? [issue({ labels: [label('one'), label('blackboard:archived')] })]
      : [issue({ labels: [label('two'), label('one'), label('old', { archived_at: '2026-01-01' })] })], {
        headers: calls === 1 ? { link: '<https://api.github.com/repos/example/chat/issues?state=all&per_page=100&page=2>; rel="next"' } : {},
      });
  });
  assert.deepEqual((await api.listTags()).map((tag) => tag.name), ['one', 'two']);
});

test('default names are suggested only while something uses them, including closed issues and pull requests', async () => {
  let used = true;
  const api = client(async (url) => {
    assert.match(url, /\/issues\?state=all/);
    return Response.json(used ? [issue({ state: 'closed', labels: [label('question')] }), issue({ pull_request: {}, labels: [label('good first issue')] })] : [issue()]);
  });
  assert.deepEqual((await api.listTags()).map((tag) => tag.name), ['good first issue', 'question']);
  used = false;
  assert.deepEqual(await api.listTags(), []);
});

test('tag suggestions share the topic polling request rather than adding repository reads', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return Response.json([issue({ labels: [label('custom')] })]); });
  const [topics, tags] = await Promise.all([api.listChannels({ includeClosed: true }), api.listTags()]);
  assert.equal(calls, 1);
  assert.equal(topics[0].tags[0].name, 'custom');
  assert.equal(tags[0].name, 'custom');
});

test('applying an existing tag appends one canonical label without replacing any other labels', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/issues/1')) return Response.json(issue());
    if (options.method === 'GET') return Response.json(label('Design'));
    assert.equal(options.method, 'POST');
    return Response.json([label('existing'), label('Design')]);
  });
  const result = await api.addChannelTag(1, ' design ');
  assert.ok(calls[1].url.endsWith('/labels/design'));
  assert.ok(calls[2].url.endsWith('/issues/1/labels'));
  assert.deepEqual(JSON.parse(calls[2].body), { labels: ['Design'] });
  assert.deepEqual(result.map((tag) => tag.name), ['existing', 'Design']);
});

test('a freeform new tag creates the repository label before applying it', async () => {
  const writes = [];
  const api = client(async (url, options) => {
    if (url.endsWith('/issues/1')) return Response.json(issue());
    if (options.method === 'GET') return Response.json({ message: 'Not found' }, { status: 404 });
    writes.push({ url, body: JSON.parse(options.body) });
    return Response.json(url.endsWith('/issues/1/labels') ? [label('New tag')] : label('New tag'));
  });
  assert.equal((await api.addChannelTag(1, 'New tag'))[0].name, 'New tag');
  assert.deepEqual(writes.map((call) => call.body), [{ name: 'New tag', color: '52769b' }, { labels: ['New tag'] }]);
});

test('label creation races reuse the label created by another client', async () => {
  let lookups = 0;
  const api = client(async (url, options) => {
    if (url.endsWith('/issues/1')) return Response.json(issue());
    if (url.endsWith('/labels/race')) return ++lookups === 1
      ? Response.json({ message: 'Not found' }, { status: 404 }) : Response.json(label('race'));
    if (url.endsWith('/chat/labels')) return Response.json({ message: 'Already exists' }, { status: 422 });
    assert.equal(options.method, 'POST');
    return Response.json([label('race')]);
  });
  assert.equal((await api.addChannelTag(1, 'race'))[0].name, 'race');
  assert.equal(lookups, 2);
});

test('removing a tag encodes its name and never deletes the repository label', async () => {
  const api = client(async (url, options) => {
    if (options.method === 'GET') return Response.json(issue());
    assert.equal(options.method, 'DELETE');
    assert.equal(url, 'https://api.github.com/repos/example/chat/issues/1/labels/ui%2Fdesign');
    return Response.json([label('other')]);
  });
  assert.deepEqual((await api.removeChannelTag(1, 'ui/design')).map((tag) => tag.name), ['other']);
});

test('invalid and internal tags never issue a request; non-topics cannot be tagged', async () => {
  const api = client(async () => assert.fail('Unexpected request'));
  for (const name of ['', ' ', 'a'.repeat(51), 'two\nlines', 'BLACKBOARD:ARCHIVED']) {
    await assert.rejects(api.addChannelTag(1, name));
    await assert.rejects(api.removeChannelTag(1, name));
  }
  const unrelated = client(async (url, options) => {
    assert.equal(options.method, 'GET');
    return Response.json(issue({ title: 'Unrelated' }));
  });
  await assert.rejects(unrelated.addChannelTag(1, 'tag'), /Only Blackboard/);
  await assert.rejects(unrelated.removeChannelTag(1, 'tag'), /Only Blackboard/);
});

test('an uncertain label creation is distinguished from uncertain topic application', async () => {
  const api = client(async (url, options) => {
    if (url.endsWith('/issues/1')) return Response.json(issue());
    if (options.method === 'GET') return Response.json({ message: 'Not found' }, { status: 404 });
    throw new TypeError('Network failed');
  });
  await assert.rejects(api.addChannelTag(1, 'tag'), (error) => error.uncertain && error.tagNotApplied);
  const application = client(async (url, options) => {
    if (url.endsWith('/issues/1')) return Response.json(issue());
    if (options.method === 'GET') return Response.json(label('tag'));
    throw new TypeError('Network failed');
  });
  await assert.rejects(application.addChannelTag(1, 'tag'), (error) => error.uncertain && !error.tagNotApplied);
});

test('topic labels become tags with safe colors and exclude the archive marker', async () => {
  const api = client(async () => Response.json([issue({ labels: [label('work', { color: 'ff0000' }), label('bad color', { color: 'red;display:none' }), label('blackboard:archived')] })]));
  const topics = await api.listChannels({ includeArchived: true });
  assert.equal(topics[0].archived, true);
  assert.deepEqual(topics[0].tags.map(({ name, color }) => [name, color]), [['work', 'ff0000'], ['bad color', '52769b']]);
});

test('stale polls preserve tag changes; confirmation ignores ordering and capitalization', () => {
  const tracker = createTopicTracker();
  const topic = { id: 1, name: 'Topic', state: 'open', archived: false, tags: [label('work'), label('Design')] };
  tracker.remember(topic);
  assert.equal(tracker.reconcile([{ ...topic, tags: [] }])[0].tags.length, 2);
  assert.equal(tracker.reconcile([{ ...topic, tags: [label('design'), label('work')] }])[0].syncState, undefined);
  tracker.remember({ ...topic, tags: [label('work')] });
  assert.equal(tracker.reconcile([topic])[0].tags.length, 1);
});
