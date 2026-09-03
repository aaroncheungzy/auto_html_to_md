const test = require('node:test');
const assert = require('node:assert/strict');
const { isCompatibilityFallback } = require('../utils/htmlQuality.js');

test('recognizes browser compatibility fallback pages as invalid conversion input', () => {
  assert.equal(isCompatibilityFallback('检测到您正在使用兼容模式/旧版IE浏览器，功能可能无法正常使用'), true);
  assert.equal(isCompatibilityFallback('职位职责\n• 审计与咨询服务'), false);
});
