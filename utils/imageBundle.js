/* utils/imageBundle.js
 * 把 Markdown 中的远程图片抓取为字节，连同 Markdown 一起打包成一个 ZIP 下载，
 * 避免逐张图片触发多次下载确认。供 preview.js（单页）与 batch.js（批量）复用。
 * 依赖全局 JSZip（在页面中通过 <script> 引入 lib/jszip.min.js）。
 */
(() => {
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 从 markdown 提取远程图片 URL：![alt](url) 或 ![alt](url "title")
  function extractImageUrls(md) {
    const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    const out = [];
    let m;
    while ((m = re.exec(md)) !== null) {
      const u = m[1].trim();
      if (/^(https?:|ftp:)/i.test(u)) out.push(u); // 仅处理远程图片（data:/blob: 无法直下）
    }
    return out;
  }

  function extFromUrl(u) {
    const path = u.split('?')[0].split('#')[0];
    const m = path.match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toLowerCase() : '';
  }

  // 为一组 url 分配不冲突的本地文件名（img1.ext / img2.ext ...）
  function assignNames(urls) {
    const map = new Map();
    const used = new Set();
    urls.forEach((u, i) => {
      if (map.has(u)) return;
      const ext = extFromUrl(u);
      const base = `img${i + 1}`;
      let name = ext ? `${base}.${ext}` : base;
      let n = 1;
      while (used.has(name)) { n++; name = ext ? `${base}_${n}.${ext}` : `${base}_${n}`; }
      used.add(name);
      map.set(u, name);
    });
    return map;
  }

  // 带凭据抓取图片字节（扩展页有 <all_urls> host 权限，可跨域读取；credentials 携带登录态 cookie）
  function fetchImageBytes(url) {
    return new Promise((resolve) => {
      try {
        fetch(url, { credentials: 'include', redirect: 'follow' })
          .then((resp) => {
            if (!resp || !resp.ok) return resolve(null);
            return resp.arrayBuffer();
          })
          .then((buf) => resolve(buf || null))
          .catch(() => resolve(null));
      } catch (_) { resolve(null); }
    });
  }

  function dirOf(p) {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  }
  // 从 md 文件位置出发，计算指向顶层 images/<name> 的相对路径
  function relFromMd(mdPath, target) {
    const d = dirOf(mdPath);
    const depth = d ? d.split('/').length : 0;
    return (depth ? '../'.repeat(depth) : '') + target;
  }

  /**
   * 将若干篇 Markdown 及其远程图片打包为一个 ZIP。
   * @param {object} opts
   * @param {Array<{mdPath:string, markdown:string}>} opts.pages  每篇在 zip 内的相对路径与内容
   * @param {string} opts.baseName  下载文件名（不含扩展名），如 'auto_html_to_md/标题'
   * @param {Map} [opts.imgCache]   跨页去重缓存：url -> {name, bytes}
   * @returns {Promise<{blob:Blob, filename:string, imageCount:number, failed:string[]}>}
   */
  async function bundleToZip({ pages, baseName, imgCache }) {
    if (!window.JSZip) throw new Error('JSZip 未加载');
    const zip = new window.JSZip();

    const cache = imgCache || new Map();
    const allUrls = [];
    pages.forEach((p) => extractImageUrls(p.markdown).forEach((u) => {
      if (!allUrls.includes(u)) allUrls.push(u);
    }));

    const names = assignNames(allUrls);
    const failed = [];
    const bytesMap = new Map();

    if (allUrls.length) {
      await Promise.all(allUrls.map(async (u) => {
        if (cache.has(u)) { bytesMap.set(u, cache.get(u).bytes); return; }
        const bytes = await fetchImageBytes(u);
        if (bytes == null) { failed.push(u); return; }
        bytesMap.set(u, bytes);
        cache.set(u, { name: names.get(u), bytes });
      }));
      // 写图片（顶层 images/）
      allUrls.forEach((u) => {
        if (failed.includes(u)) return;
        zip.file('images/' + names.get(u), bytesMap.get(u));
      });
    }

    // 写 Markdown（改写图片链接为相对路径）
    pages.forEach((p) => {
      let md = p.markdown;
      allUrls.forEach((u) => {
        if (failed.includes(u)) return;
        const rel = relFromMd(p.mdPath, 'images/' + names.get(u));
        const re = new RegExp('!\\[[^\\]]*\\]\\(' + escapeRegExp(u) + '(?:\\s+"[^"]*")?\\)', 'g');
        md = md.replace(re, (full) => full.split(u).join(rel));
      });
      zip.file(p.mdPath, md);
    });

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { blob, filename: baseName + '.zip', imageCount: allUrls.length - failed.length, failed };
  }

  window.ImageBundle = { bundleToZip, extractImageUrls, assignNames };
})();
