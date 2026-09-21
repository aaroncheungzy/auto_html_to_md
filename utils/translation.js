(() => {
  const DEFAULT_TRANSLATION_SETTINGS = Object.freeze({
    translationProvider: 'azure',
    translationApiKey: '',
    translationRegion: '',
    translationChineseTarget: 'en',
    translationOtherTarget: 'zh-Hans'
  });

  function normalizeTranslationSettings(settings) {
    const input = settings || {};
    return {
      translationProvider: input.translationProvider || DEFAULT_TRANSLATION_SETTINGS.translationProvider,
      translationApiKey: input.translationApiKey || '',
      translationRegion: input.translationRegion || '',
      translationChineseTarget: input.translationChineseTarget || DEFAULT_TRANSLATION_SETTINGS.translationChineseTarget,
      translationOtherTarget: input.translationOtherTarget || DEFAULT_TRANSLATION_SETTINGS.translationOtherTarget
    };
  }

  function containsChinese(text) {
    return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(String(text || ''));
  }

  function resolveTargetLanguage(text, settings) {
    const normalized = normalizeTranslationSettings(settings);
    return containsChinese(text)
      ? normalized.translationChineseTarget
      : normalized.translationOtherTarget;
  }

  function translationError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async function translateWithAzure(text, settings, fetchImpl) {
    const normalized = normalizeTranslationSettings(settings);
    const sourceText = String(text || '').trim();
    if (!sourceText) throw translationError('没有可翻译的文字', 'EMPTY_TEXT');
    if (!normalized.translationApiKey.trim()) {
      throw translationError('请先在翻译设置中填写 Azure Translator Key', 'CONFIG_REQUIRED');
    }

    const targetLanguage = resolveTargetLanguage(sourceText, normalized);
    const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
    url.searchParams.set('api-version', '3.0');
    url.searchParams.set('to', targetLanguage);
    const headers = {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': normalized.translationApiKey.trim()
    };
    if (normalized.translationRegion.trim()) {
      headers['Ocp-Apim-Subscription-Region'] = normalized.translationRegion.trim();
    }

    const request = fetchImpl || globalThis.fetch;
    let response;
    try {
      response = await request(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify([{ text: sourceText }])
      });
    } catch (_) {
      throw translationError('无法连接 Azure Translator，请检查网络后重试', 'NETWORK_ERROR');
    }
    if (!response.ok) {
      throw translationError(`Azure Translator 请求失败（HTTP ${response.status}）`, `AZURE_HTTP_${response.status}`);
    }

    let data;
    try { data = await response.json(); }
    catch (_) { throw translationError('翻译服务返回了无法识别的数据', 'INVALID_RESPONSE'); }
    const first = Array.isArray(data) ? data[0] : null;
    const translation = first && Array.isArray(first.translations) ? first.translations[0] : null;
    if (!translation || typeof translation.text !== 'string') {
      throw translationError('翻译服务未返回译文', 'INVALID_RESPONSE');
    }
    return {
      translatedText: translation.text,
      sourceLanguage: (first.detectedLanguage && first.detectedLanguage.language) || 'auto',
      targetLanguage: translation.to || targetLanguage
    };
  }

  const api = {
    DEFAULT_TRANSLATION_SETTINGS,
    normalizeTranslationSettings,
    containsChinese,
    resolveTargetLanguage,
    translateWithAzure
  };
  if (typeof globalThis !== 'undefined') globalThis.TranslationFeature = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
