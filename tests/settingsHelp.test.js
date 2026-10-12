const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(tagName = 'LABEL') {
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = {};
      this.style = {};
      this.listeners = {};
      this.children = [];
      this.textContent = '';
      this.hidden = false;
    }
    appendChild(child) { this.children.push(child); }
    append(...children) { this.children.push(...children); }
    before(element) { this.previousWrapper = element; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    dispatch(name, event = {}) { this.listeners[name]?.(event); }
    getBoundingClientRect() {
      return this.className === 'setting-tooltip'
        ? { width: 280, height: 100 }
        : { right: 345, top: 460, bottom: 482 };
    }
  }
  const label = new Element(tagName);
  label.textContent = '图片设置';
  label.dataset = { help: '这是图片设置的详细说明。' };
  const document = new Element('DOCUMENT');
  document.body = new Element('BODY');
  const created = [];
  document.createElement = tag => {
    const element = new Element(tag.toUpperCase());
    created.push(element);
    return element;
  };
  document.querySelectorAll = () => [label];
  const window = new Element('WINDOW');
  const context = { document, window, innerWidth: 360, innerHeight: 600 };
  vm.runInNewContext(fs.readFileSync(require.resolve('../utils/settingsHelp.js'), 'utf8'), context);
  const tooltip = document.body.children[0];
  // The question button is the label's sibling in the generated wrapper.
  const button = created.find(element => element.tagName === 'BUTTON');
  return { context, window, document, tooltip, button, target: label };
}

test('hover help remains visible and is repositioned when the action popup resizes', () => {
  const { context, window, tooltip, button } = fixture();
  button.dispatch('mouseenter');
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.textContent, '这是图片设置的详细说明。');
  assert.equal(tooltip.style.left, '65px');
  context.innerWidth = 300;
  context.innerHeight = 500;
  window.dispatch('resize');
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.style.left, '12px');
  assert.equal(tooltip.style.top, '352px');
});

test('action-button explanations use a sibling help control instead of a nested button', () => {
  const { target, button, tooltip } = fixture('BUTTON');
  assert.equal(target.children.length, 0);
  assert.equal(target.previousWrapper.children[0], target);
  assert.equal(target.previousWrapper.children[1], button);
  button.dispatch('mouseenter');
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.textContent, '这是图片设置的详细说明。');
});

test('hover leave and Escape still dismiss help after resizing', () => {
  const { window, document, tooltip, button } = fixture();
  button.dispatch('mouseenter');
  window.dispatch('resize');
  button.dispatch('mouseleave');
  assert.equal(tooltip.hidden, true);
  button.dispatch('focus');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(tooltip.hidden, true);
  window.dispatch('resize');
  assert.equal(tooltip.hidden, true);
});
