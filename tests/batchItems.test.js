const test = require('node:test');
const assert = require('node:assert/strict');
const { itemKey, mergeBatchItems } = require('../utils/batchItems.js');

test('uses the action id instead of javascript href as an interactive item identity', () => {
  assert.equal(itemKey({ kind: 'interactive', actionId: 'picker-42', url: 'javascript:;' }), 'interactive:picker-42');
});

test('merges regular URLs and interactive items without collapsing distinct menu actions', () => {
  const result = mergeBatchItems(
    [{ kind: 'link', url: 'https://example.com/a', text: 'A' }],
    [
      { kind: 'link', url: 'https://example.com/a#section', text: 'Duplicate A' },
      { kind: 'interactive', actionId: 'menu-1', text: '北京分行', url: 'javascript:;' },
      { kind: 'interactive', actionId: 'menu-2', text: '上海分行', url: 'javascript:;' },
      { kind: 'interactive', actionId: 'menu-1', text: '北京分行 duplicate', url: 'javascript:;' }
    ]
  );

  assert.deepEqual(result.items.map((item) => itemKey(item)), [
    'link:https://example.com/a',
    'interactive:menu-1',
    'interactive:menu-2'
  ]);
  assert.equal(result.added, 2);
});
