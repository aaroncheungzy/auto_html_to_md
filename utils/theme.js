(() => {
  const DEFAULT_COLOR = '#2563eb';
  const PRESETS = [
    ['#2563eb', '蓝色'], ['#0f766e', '青绿'], ['#7c3aed', '紫色'],
    ['#be123c', '玫红'], ['#b45309', '琥珀'], ['#334155', '石墨']
  ];
  function normalizeColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
  }
  function palette(value) {
    const color = normalizeColor(value);
    const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
    const luminance = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const hex = (values) => '#' + values.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return {
      '--primary': color,
      '--primary-hover': hex(rgb.map((v) => v * 0.85)),
      '--primary-soft': hex(rgb.map((v) => v + (255 - v) * 0.93)),
      '--on-primary': luminance > 0.179 ? '#111827' : '#ffffff',
      '--accent': color,
      '--accent-hover': hex(rgb.map((v) => v * 0.85))
    };
  }
  function apply(element, color) {
    Object.entries(palette(color)).forEach(([name, value]) => element.style.setProperty(name, value));
  }
  function normalizeMode(value) {
    return ['system', 'light', 'dark'].includes(value) ? value : 'system';
  }
  function applyMode(element, mode, systemDark) {
    const dark = normalizeMode(mode) === 'dark' || (normalizeMode(mode) === 'system' && systemDark);
    element.setAttribute('data-theme', dark ? 'dark' : 'light');
    return dark;
  }
  const api = { DEFAULT_COLOR, PRESETS, normalizeColor, normalizeMode, palette, apply, applyMode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;
  window.AppTheme = api;
  let currentColor = DEFAULT_COLOR;
  let revision = 0;
  let currentMode = 'system';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const subscribers = new Set();
  const isExtensionPage = /^(chrome|moz)-extension:$/.test(location.protocol);
  function publish(value) {
    currentColor = normalizeColor(value);
    if (isExtensionPage) {
      apply(document.documentElement, currentColor);
      applyMode(document.documentElement, currentMode, media.matches);
    }
    subscribers.forEach((callback) => callback(currentColor, currentMode, media.matches));
  }
  api.subscribe = (callback) => {
    subscribers.add(callback);
    callback(currentColor, currentMode, media.matches);
    return () => subscribers.delete(callback);
  };
  api.save = async (value) => {
    const color = normalizeColor(value);
    await chrome.storage.local.set({ themeColor: color });
    revision++;
    publish(color);
  };
  api.saveMode = async (value) => {
    const mode = normalizeMode(value);
    await chrome.storage.local.set({ themeMode: mode });
    revision++;
    currentMode = mode;
    publish(currentColor);
  };
  media.addEventListener('change', () => publish(currentColor));
  publish(DEFAULT_COLOR);
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const initialRevision = revision;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.themeColor || changes.themeMode)) {
        revision++;
        if (changes.themeMode) currentMode = normalizeMode(changes.themeMode.newValue);
        publish(changes.themeColor ? changes.themeColor.newValue : currentColor);
      }
    });
    chrome.storage.local.get(['themeColor', 'themeMode']).then(({ themeColor, themeMode }) => {
      if (revision === initialRevision) {
        currentMode = normalizeMode(themeMode);
        publish(themeColor);
      }
    }).catch(() => {});
  }
})();
