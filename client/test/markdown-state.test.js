import test from 'node:test';
import assert from 'node:assert/strict';
import { issueNumberForUrl, markdownBlocks, markdownInlines } from '../src/markdown-state.js';

test('renders the agent note shape as headings, nested lists, and links', () => {
  const blocks = markdownBlocks('## Current picture\n- **TU Wien** per #11\n  - [ ] Confirm intake\n\n1. Review [calendar](https://example.com)');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].groups[0].items[0].children[0].items[0].checked, false);
  assert.equal(blocks[2].groups[0].ordered, true);
  assert.deepEqual(markdownInlines(blocks[1].groups[0].items[0].text).map((token) => token.type), ['strong', 'text', 'issue']);
  assert.equal(markdownInlines(blocks[2].groups[0].items[0].text).at(-1).url, 'https://example.com');
});

test('comments stay out of display, including multiline comments', () => {
  const blocks = markdownBlocks('Before <!-- private\nline --> after\n\n<!-- hidden -->');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'Before \n after');
  assert.equal(markdownInlines('item <!-- hidden --> text').map((token) => token.text).join(''), 'item  text');
});

test('fenced code remains literal and an opening language does not swallow the closing fence', () => {
  const blocks = markdownBlocks('```js\n<!-- literal -->\n```\nAfter');
  assert.deepEqual(blocks, [
    { type: 'code', text: '<!-- literal -->' },
    { type: 'paragraph', text: 'After' },
  ]);
});

test('only HTTPS Markdown links become links; raw HTML is ordinary text', () => {
  const tokens = markdownInlines('[bad](javascript:alert(1)) <img src=x> [good](https://example.com)');
  assert.equal(tokens.filter((token) => token.type === 'link').length, 1);
  assert.equal(tokens.find((token) => token.type === 'link').url, 'https://example.com');
  assert.ok(tokens.some((token) => token.text?.includes('<img src=x>')));
});

test('only issue links in the connected repository can open a client topic', () => {
  const base = 'https://github.com/orazdow/Applications/issues/';
  assert.equal(issueNumberForUrl('https://github.com/orazdow/Applications/issues/12', base), 12);
  assert.equal(issueNumberForUrl('https://github.com/ORAZDOW/applications/issues/12/', base), 12);
  assert.equal(issueNumberForUrl('https://github.com/orazdow/Blackboard/issues/12', base), null);
  assert.equal(issueNumberForUrl('https://github.com/orazdow/Applications/issues/12#issuecomment-1', base), null);
  assert.equal(issueNumberForUrl('https://github.com/orazdow/Applications/pull/12', base), null);
  assert.equal(issueNumberForUrl('https://example.com/orazdow/Applications/issues/12', base), null);
});
