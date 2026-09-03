const test = require('node:test');
const assert = require('node:assert/strict');
const { textToBlocks } = require('../utils/textBlockStructure.js');

test('turns blank-line paragraphs and bullet lines into structural blocks', () => {
  assert.deepEqual(textToBlocks('第一段\n\n•\t第一项\n• 第二项\n\n第二段'), [
    { type: 'p', text: '第一段' }, { type: 'ul', items: ['第一项', '第二项'] }, { type: 'p', text: '第二段' }
  ]);
});
