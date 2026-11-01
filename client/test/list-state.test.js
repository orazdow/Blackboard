import test from 'node:test';
import assert from 'node:assert/strict';
import { appendChecklistItem, changeChecklistItem, checklist, insertChecklistChild, listDescription, replaceListDescription } from '../src/list-state.js';

test('list description edits preserve checklist items and later Markdown', () => {
  const body = 'Trip preparations\n\n- [ ] Book tickets\n- [x] Choose dates\n\nMore details';
  assert.equal(listDescription(body), 'Trip preparations');
  const edited = replaceListDescription(body, 'Travel plans');
  assert.equal(edited, 'Travel plans\n\n- [ ] Book tickets\n- [x] Choose dates\n\nMore details');
  assert.deepEqual(checklist(edited).items.map((item) => [item.checked, item.text]), [
    [false, 'Book tickets'], [true, 'Choose dates'],
  ]);
  assert.equal(replaceListDescription(body, ''), '- [ ] Book tickets\n- [x] Choose dates\n\nMore details');
});

test('a list without items can gain a description and then its first item', () => {
  assert.equal(replaceListDescription('', 'Supplies'), 'Supplies');
  assert.equal(appendChecklistItem('Supplies', 'Paper'), 'Supplies\n\n- [ ] Paper');
  assert.equal(appendChecklistItem('Supplies\r\n', 'Paper'), 'Supplies\r\n\r\n- [ ] Paper');
});

test('checklist markers inside fenced description text are not treated as items', () => {
  const body = 'Example:\n```md\n- [ ] Example only\n```\n\n- [ ] Actual item';
  assert.equal(listDescription(body), 'Example:\n```md\n- [ ] Example only\n```');
  assert.equal(checklist(replaceListDescription(body, 'Updated')).items.length, 1);
});

test('nested checklist items render at their Markdown depth and insert under the chosen parent', () => {
  const body = '- [ ] Parent\n  - [x] Child\n    - [ ] Grandchild\n- [ ] Sibling';
  assert.deepEqual(checklist(body).items.map((item) => item.depth), [0, 1, 2, 0]);
  assert.equal(insertChecklistChild(body, 0, 'New child'),
    '- [ ] Parent\n  - [x] Child\n    - [ ] Grandchild\n  - [ ] New child\n- [ ] Sibling');
  assert.equal(insertChecklistChild(body, 1, 'New grandchild'),
    '- [ ] Parent\n  - [x] Child\n    - [ ] Grandchild\n    - [ ] New grandchild\n- [ ] Sibling');
});

test('removing a parent promotes its children while keeping their relative nesting', () => {
  const body = '- [ ] Parent\n  - [x] Child\n    - [ ] Grandchild\n- [ ] Sibling';
  assert.equal(changeChecklistItem(body, 0, 'remove'),
    '- [x] Child\n  - [ ] Grandchild\n- [ ] Sibling');
  assert.equal(changeChecklistItem(body, 1, 'remove'),
    '- [ ] Parent\n  - [ ] Grandchild\n- [ ] Sibling');
});
