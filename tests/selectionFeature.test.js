const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isUnlockEnabled,
  isEligibleSelection,
  createUnlockController,
  positionFloatingButton
} = require('../utils/selectionFeature.js');
const { MarkdownConverter } = require('../utils/converter.js');

test('enables page unlocking when the setting is missing and honors an explicit opt-out', () => {
  assert.equal(isUnlockEnabled(undefined), true);
  assert.equal(isUnlockEnabled({}), true);
  assert.equal(isUnlockEnabled({ unlockSelection: true }), true);
  assert.equal(isUnlockEnabled({ unlockSelection: false }), false);
});

test('accepts non-empty document selections and rejects editable controls', () => {
  const regularNode = {
    nodeType: 3,
    parentElement: { closest: () => null }
  };
  const inputNode = {
    nodeType: 3,
    parentElement: { closest: () => ({ tagName: 'INPUT' }) }
  };

  assert.equal(isEligibleSelection({ rangeCount: 1, isCollapsed: false, toString: () => ' 正文 ', anchorNode: regularNode }), true);
  assert.equal(isEligibleSelection({ rangeCount: 1, isCollapsed: false, toString: () => '   ', anchorNode: regularNode }), false);
  assert.equal(isEligibleSelection({ rangeCount: 1, isCollapsed: false, toString: () => '表单值', anchorNode: inputNode }), false);
});

test('converts a saved range snapshot without reading the live selection', () => {
  const converter = new MarkdownConverter();
  converter.turndown = { turndown: (root) => root.fragment.markdown };
  converter.clean = (root) => root;
  const doc = {
    createElement: () => ({
      fragment: null,
      appendChild(fragment) { this.fragment = fragment; },
      cloneNode() { return this; }
    })
  };
  const range = {
    commonAncestorContainer: { ownerDocument: doc },
    cloneContents: () => ({ markdown: '选中内容' })
  };

  assert.equal(converter.convertRange(range, 'https://example.com/article'), '选中内容');
  assert.equal(converter.baseUrl, null);
});

test('unlock controller installs overrides and removes them cleanly', () => {
  const eventTarget = new EventTarget();
  const children = [];
  const attributes = new Set();
  const doc = {
    documentElement: {
      appendChild(node) { children.push(node); node.isConnected = true; },
      hasAttribute(name) { return attributes.has(name); }
    },
    createElement: () => ({
      id: '', textContent: '', isConnected: false,
      remove() {
        const index = children.indexOf(this);
        if (index >= 0) children.splice(index, 1);
        this.isConnected = false;
      }
    }),
    getElementById: (id) => children.find((node) => node.id === id) || null
  };
  const win = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    getSelection: () => ({ rangeCount: 1, isCollapsed: false, toString: () => '正文' })
  };
  const controller = createUnlockController(doc, win);
  controller.enable();

  let pageCopyHandlerRan = false;
  eventTarget.addEventListener('copy', () => { pageCopyHandlerRan = true; });
  const copyWhileEnabled = new Event('copy', { cancelable: true });
  eventTarget.dispatchEvent(copyWhileEnabled);
  assert.equal(children.length, 1);
  assert.equal(pageCopyHandlerRan, false);
  assert.equal(copyWhileEnabled.defaultPrevented, false);

  let pickerContextHandlerRan = false;
  eventTarget.addEventListener('contextmenu', () => { pickerContextHandlerRan = true; });
  attributes.add('data-auto-html-to-md-picker-active');
  eventTarget.dispatchEvent(new Event('contextmenu', { cancelable: true }));
  assert.equal(pickerContextHandlerRan, true);

  controller.disable();
  eventTarget.dispatchEvent(new Event('copy', { cancelable: true }));
  assert.equal(children.length, 0);
  assert.equal(pageCopyHandlerRan, true);
});

test('positions the floating action near the selection and clamps it inside the viewport', () => {
  assert.deepEqual(
    positionFloatingButton({ left: 100, right: 260, top: 80, bottom: 120 }, 1000, 800, 144, 40),
    { left: 116, top: 128 }
  );
  assert.deepEqual(
    positionFloatingButton({ left: 920, right: 999, top: 760, bottom: 790 }, 1000, 800, 144, 40),
    { left: 848, top: 712 }
  );
});
