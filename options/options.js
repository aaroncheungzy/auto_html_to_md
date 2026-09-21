(() => {
  const $ = (id) => document.getElementById(id);
  const LANGUAGES = [
    ['zh-Hans', '简体中文'], ['zh-Hant', '繁体中文'], ['en', '英语'],
    ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'],
    ['es', '西班牙语'], ['ru', '俄语'], ['pt', '葡萄牙语'], ['it', '意大利语']
  ];

  function populate(select) {
    LANGUAGES.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  function setStatus(text, error = false) {
    const status = $('status');
    status.textContent = text;
    status.className = `settings-status ${error ? 'err' : 'ok'}`;
  }

  async function load() {
    populate($('translation-chinese-target'));
    populate($('translation-other-target'));
    const { settings } = await chrome.storage.local.get(['settings']);
    const normalized = window.TranslationFeature.normalizeTranslationSettings(settings);
    $('translation-api-key').value = normalized.translationApiKey;
    $('translation-region').value = normalized.translationRegion;
    $('translation-chinese-target').value = normalized.translationChineseTarget;
    $('translation-other-target').value = normalized.translationOtherTarget;
  }

  async function save() {
    const { settings } = await chrome.storage.local.get(['settings']);
    await chrome.storage.local.set({
      settings: {
        ...(settings || {}),
        translationProvider: 'azure',
        translationApiKey: $('translation-api-key').value.trim(),
        translationRegion: $('translation-region').value.trim(),
        translationChineseTarget: $('translation-chinese-target').value,
        translationOtherTarget: $('translation-other-target').value
      }
    });
    setStatus('已保存');
  }

  $('toggle-key').addEventListener('click', () => {
    const input = $('translation-api-key');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggle-key').textContent = show ? '隐藏' : '显示';
  });
  $('save').addEventListener('click', () => save().catch(() => setStatus('保存失败', true)));
  $('clear-key').addEventListener('click', async () => {
    $('translation-api-key').value = '';
    await save();
    setStatus('Key 已清除');
  });
  document.addEventListener('DOMContentLoaded', () => load().catch(() => setStatus('读取设置失败', true)));
})();
