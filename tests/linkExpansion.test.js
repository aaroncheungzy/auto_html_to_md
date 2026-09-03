const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDocumentUrl, isChildDirectoryUrl, mergeExpandedLinks } = require('../utils/linkExpansion.js');

test('normalizes fragments and default ports before deduplication', () => {
  assert.equal(
    normalizeDocumentUrl('https://docs.example.com:443/guide/intro/#section-2'),
    'https://docs.example.com/guide/intro/'
  );
});

test('accepts only same-origin URLs strictly inside the selected directory', () => {
  const directory = 'https://docs.example.com/guide/';

  assert.equal(isChildDirectoryUrl('https://docs.example.com/guide/setup/', directory), true);
  assert.equal(isChildDirectoryUrl('https://docs.example.com/guide/', directory), false);
  assert.equal(isChildDirectoryUrl('https://docs.example.com/guidelines/', directory), false);
  assert.equal(isChildDirectoryUrl('https://other.example.com/guide/setup/', directory), false);
});

test('merges only eligible children, removes duplicates, and respects the maximum count', () => {
  const existing = [{ url: 'https://docs.example.com/guide/' }];
  const candidates = [
    { url: 'https://docs.example.com/guide/a/', text: 'A' },
    { url: 'https://docs.example.com/guide/a/#heading', text: 'A duplicate' },
    { url: 'https://docs.example.com/guide/b/', text: 'B' },
    { url: 'https://docs.example.com/outside/', text: 'Outside' }
  ];

  const result = mergeExpandedLinks(existing, candidates, 'https://docs.example.com/guide/', 3);

  assert.deepEqual(result.links.map((link) => link.url), [
    'https://docs.example.com/guide/',
    'https://docs.example.com/guide/a/',
    'https://docs.example.com/guide/b/'
  ]);
  assert.equal(result.added, 2);
  assert.equal(result.limitReached, false);
});
