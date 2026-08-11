/* preview/preview.js */
(() => {
  const $ = (id) => document.getElementById(id);
  let markdown = '';
  let title = '';

  function timestampStr() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function sanitizeTitle(t) {
    let s = (t || '未命名').replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
    s = s.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return s.slice(0, 80) || '未命名';
  }
  function downloadText(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    if (name === 'raw') { $('raw').hidden = false; $('rendered').hidden = true; }
    else { $('raw').hidden = true; $('rendered').hidden = false;
      try { $('rendered').innerHTML = marked.parse(markdown); } catch (e) { $('rendered').textContent = '渲染失败：' + e.message; }
    }
  }

  async function init() {
    const { previewContent, previewTitle } = await chrome.storage.local.get(['previewContent', 'previewTitle']);
    markdown = previewContent || '';
    title = previewTitle || '';
    $('title').textContent = title ? `Markdown 预览 - ${title}` : 'Markdown 预览';
    $('raw').textContent = markdown;
    chrome.storage.local.remove(['previewContent', 'previewTitle']);
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  }

  $('btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(markdown); $('btn-copy').textContent = '✓ 已复制'; setTimeout(() => $('btn-copy').textContent = '📋 复制', 1500); }
    catch (e) { alert('复制失败：' + e.message); }
  });
  $('btn-download').addEventListener('click', async () => {
    let settings = {};
    try { settings = (await chrome.storage.local.get(['settings'])).settings || {}; } catch (_) {}
    const st = sanitizeTitle(title);
    if (settings.bundleImages && window.JSZip && window.ImageBundle) {
      // 打包为单个 ZIP：Markdown + 图片都在压缩包内，只触发一次下载
      try {
        const zip = await window.ImageBundle.bundleToZip({
          pages: [{ mdPath: `${st}.md`, markdown }],
          baseName: `auto_html_to_md/${st}`
        });
        downloadBlob(zip.blob, zip.filename);
        return;
      } catch (e) { console.error('打包 ZIP 失败，降级为纯 Markdown：', e); }
    }
    downloadText(markdown, `${st}_${timestampStr()}.md`);
  });

  document.addEventListener('DOMContentLoaded', init);
})();
