import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAuthorMetadata, withAuthorMetadata } from '../src/author-metadata.js';
import { listDescription, replaceListDescription } from '../src/list-state.js';

test('a first-line author comment is separate from the visible topic body', () => {
  assert.deepEqual(splitAuthorMetadata('<!-- @dot -->\n## Plan'), {
    author: 'dot', prefix: '<!-- @dot -->\n', content: '## Plan',
  });
  assert.equal(splitAuthorMetadata('<!-- @dot -->').content, '');
  assert.equal(splitAuthorMetadata('Intro\n<!-- @dot -->').author, null);
  assert.equal(splitAuthorMetadata('<!-- @Dot -->\nIntro').author, null);
});

test('editing topic content preserves its author line', () => {
  const original = '<!-- @dot -->\r\n- [ ] Alpha';
  const { content } = splitAuthorMetadata(original);
  assert.equal(listDescription(content), '');
  assert.equal(withAuthorMetadata(original, replaceListDescription(content, 'Supplies')),
    '<!-- @dot -->\r\nSupplies\r\n\r\n- [ ] Alpha');
  assert.equal(withAuthorMetadata('<!-- @dot -->\nOld note', 'New note'), '<!-- @dot -->\nNew note');
  assert.equal(withAuthorMetadata('<!-- @dot -->', 'New note'), '<!-- @dot -->\nNew note');
  assert.equal(withAuthorMetadata('Old note', 'New note'), 'New note');
});
