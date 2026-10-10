const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeColor, normalizeMode, palette, applyMode } = require('../utils/theme.js');

test('accepts hex colors and rejects arbitrary CSS input', () => {
  assert.equal(normalizeColor('#ABCDEF'), '#abcdef');
  assert.equal(normalizeColor('red; display:none'), '#2563eb');
  assert.equal(normalizeColor(undefined), '#2563eb');
});

test('keeps text readable on light and dark custom theme colors', () => {
  assert.equal(palette('#ffffff')['--on-primary'], '#111827');
  assert.equal(palette('#000000')['--on-primary'], '#ffffff');
  assert.equal(palette('#0f766e')['--primary'], '#0f766e');
});

test('defaults to system mode and respects explicit overrides', () => {
  const element = { setAttribute: (name, value) => { element[name] = value; } };
  assert.equal(normalizeMode(undefined), 'system');
  applyMode(element, 'system', true);
  assert.equal(element['data-theme'], 'dark');
  applyMode(element, 'system', false);
  assert.equal(element['data-theme'], 'light');
  applyMode(element, 'light', true);
  assert.equal(element['data-theme'], 'light');
  applyMode(element, 'dark', false);
  assert.equal(element['data-theme'], 'dark');
});
