const test = require('node:test');
const assert = require('node:assert/strict');

test('image download defaults on but decorative images default off', () => {
  const { read } = require('../utils/imageSettings.js');
  assert.deepEqual(read(), { download: true, decorative: false, effectiveDecorative: false });
});

test('turning download off suspends decorative images without discarding the preference', () => {
  const { read } = require('../utils/imageSettings.js');
  assert.deepEqual(read({ bundleImages: false, keepAllImages: true }), {
    download: false, decorative: true, effectiveDecorative: false
  });
  assert.equal(read({ bundleImages: true, keepAllImages: true }).effectiveDecorative, true);
});

test('image controls persist only the changed preference and synchronize external changes', async () => {
  const { bind } = require('../utils/imageSettings.js');
  const control = () => ({ checked: false, disabled: false, listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; } });
  const download = control();
  const decorative = control();
  let settings = { keepAllImages: true, unlockSelection: false };
  let changed;
  const storage = {
    local: { get: async () => ({ settings }), set: async (value) => {
      settings = value.settings;
      changed({ settings: { newValue: settings } }, 'local');
    } },
    onChanged: { addListener(fn) { changed = fn; } }
  };
  await bind(download, decorative, storage);
  assert.equal(download.checked, true);
  assert.equal(decorative.disabled, false);
  download.checked = false;
  await download.listeners.change();
  assert.equal(decorative.disabled, true);
  assert.equal(decorative.checked, true);
  assert.equal(settings.keepAllImages, true);
  assert.equal(settings.unlockSelection, false);
  settings = { bundleImages: true, keepAllImages: false };
  changed({ settings: { newValue: settings } }, 'local');
  assert.equal(download.checked, true);
  assert.equal(decorative.disabled, false);
  assert.equal(decorative.checked, false);
});

test('a failed preference write restores the saved controls and reports failure', async () => {
  const { bind } = require('../utils/imageSettings.js');
  const control = () => ({ listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const download = control();
  const decorative = control();
  const statuses = [];
  await bind(download, decorative, {
    local: {
      get: async () => ({ settings: { bundleImages: true, keepAllImages: true } }),
      set: async () => { throw new Error('storage unavailable'); }
    },
    onChanged: { addListener() {} }
  }, (message, failed) => statuses.push({ message, failed }));
  download.checked = false;
  await download.listeners.change();
  assert.equal(download.checked, true);
  assert.equal(decorative.disabled, false);
  assert.equal(decorative.checked, true);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].failed, true);
});

test('overlapping image updates preserve both preferences in shared storage', async () => {
  const { createUpdater } = require('../utils/imageSettings.js');
  assert.equal(typeof createUpdater, 'function');
  let settings = { bundleImages: true, keepAllImages: false, unlockSelection: false };
  const update = createUpdater({ local: {
    get: async () => {
      const snapshot = { ...settings };
      await new Promise(resolve => setTimeout(resolve, 5));
      return { settings: snapshot };
    },
    set: async value => { settings = value.settings; }
  } });
  await Promise.all([update({ keepAllImages: true }), update({ bundleImages: false })]);
  assert.deepEqual(settings, { bundleImages: false, keepAllImages: true, unlockSelection: false });
});
