import test from 'node:test';
import assert from 'node:assert/strict';
import { messageBlocks, messageTokens, quoteReply } from '../src/message-format.js';

test('quote replies preserve multiline text and link to the original comment', () => {
  assert.equal(quoteReply({ sender: 'dot', author: 'orazdow', text: 'Hello\n\nWorld', url: 'https://github.com/orazdow/Blackboard/issues/1#issuecomment-2' }),
    '[dot](https://github.com/orazdow/Blackboard/issues/1#issuecomment-2) wrote:\n> Hello\n> \n> World\n\n');
});

test('consecutive quote lines form one block and replies remain outside it', () => {
  assert.deepEqual(messageBlocks('> Hello\n> World\n\nMy reply'), [
    { quote: true, text: 'Hello\nWorld' }, { quote: false, text: '\nMy reply' },
  ]);
});

test('mentions avoid email addresses and inline code', () => {
  assert.deepEqual(messageTokens('@dot ask @orazdow; a@b.com `@code`').filter((token) => token.type === 'mention').map((token) => token.name), ['dot', 'orazdow']);
  assert.deepEqual(messageTokens('`@dot`'), [{ type: 'code', text: '@dot' }]);
});

test('message HTML stays text and executable URLs never become links', () => {
  assert.deepEqual(messageTokens('<img src=x onerror=alert(1)> [bad](javascript:alert(1))'), [
    { type: 'text', text: '<img src=x onerror=alert(1)> [bad](javascript:alert(1))' },
  ]);
  assert.deepEqual(messageTokens('[source](https://github.com/a/b)'), [{ type: 'link', text: 'source', url: 'https://github.com/a/b' }]);
  assert.equal(quoteReply({ author: 'user', text: 'Hi', url: 'javascript:alert(1)' }), 'user wrote:\n> Hi\n\n');
});
