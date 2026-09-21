const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TRANSLATION_SETTINGS,
  normalizeTranslationSettings,
  resolveTargetLanguage,
  translateWithAzure
} = require('../utils/translation.js');

test('defaults Chinese selections to English and other text to Simplified Chinese', () => {
  assert.equal(resolveTargetLanguage('这是一段中文。', {}), 'en');
  assert.equal(resolveTargetLanguage('This is English.', {}), 'zh-Hans');
  assert.equal(resolveTargetLanguage('123!?', {}), 'zh-Hans');
});

test('uses the configured target languages for each default direction', () => {
  const settings = { translationChineseTarget: 'ja', translationOtherTarget: 'zh-Hant' };
  assert.equal(resolveTargetLanguage('中文内容', settings), 'ja');
  assert.equal(resolveTargetLanguage('English text', settings), 'zh-Hant');
});

test('normalizes missing translation settings without exposing a bundled key', () => {
  assert.deepEqual(normalizeTranslationSettings({}), DEFAULT_TRANSLATION_SETTINGS);
  assert.equal(DEFAULT_TRANSLATION_SETTINGS.translationApiKey, '');
  assert.equal(DEFAULT_TRANSLATION_SETTINGS.translationProvider, 'azure');
});

test('calls Azure Translator with automatic source detection and parses its response', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => [{
        detectedLanguage: { language: 'en', score: 1 },
        translations: [{ text: '你好', to: 'zh-Hans' }]
      }]
    };
  };

  const result = await translateWithAzure('Hello', {
    translationApiKey: 'user-key',
    translationRegion: 'eastasia',
    translationOtherTarget: 'zh-Hans'
  }, fetchImpl);

  assert.match(request.url, /api-version=3\.0/);
  assert.match(request.url, /to=zh-Hans/);
  assert.equal(request.options.headers['Ocp-Apim-Subscription-Key'], 'user-key');
  assert.equal(request.options.headers['Ocp-Apim-Subscription-Region'], 'eastasia');
  assert.deepEqual(JSON.parse(request.options.body), [{ text: 'Hello' }]);
  assert.deepEqual(result, {
    translatedText: '你好', sourceLanguage: 'en', targetLanguage: 'zh-Hans'
  });
});

test('splits very long selections into safe requests and combines every translated chunk', async () => {
  const calls = [];
  const input = 'a'.repeat(45001);
  const result = await translateWithAzure(input, {
    translationApiKey: 'user-key',
    translationOtherTarget: 'zh-Hans'
  }, async (_url, options) => {
    const [{ text }] = JSON.parse(options.body);
    calls.push(text);
    return {
      ok: true,
      json: async () => [{
        detectedLanguage: { language: 'en', score: 1 },
        translations: [{ text: text.toUpperCase(), to: 'zh-Hans' }]
      }]
    };
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].length, 45000);
  assert.equal(calls[1].length, 1);
  assert.equal(result.translatedText, input.toUpperCase());
});

test('requires a user key and does not leak it through API errors', async () => {
  await assert.rejects(
    () => translateWithAzure('Hello', {}, async () => { throw new Error('should not run'); }),
    (error) => error && error.code === 'CONFIG_REQUIRED'
  );

  const secret = 'very-secret-user-key';
  await assert.rejects(
    () => translateWithAzure('Hello', { translationApiKey: secret }, async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: `invalid ${secret}` } })
    })),
    (error) => error && error.code === 'AZURE_HTTP_401' && !error.message.includes(secret)
  );
});
