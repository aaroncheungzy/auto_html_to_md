/* utils/converter.js
 * HTML -> Markdown 转换器。
 * 可在 content script（使用页面 document）与 offscreen document（使用 DOMParser）中复用。
 *
 * 正文识别策略（三级）：
 *  1. Mozilla Readability（Firefox 阅读模式引擎）——首选，最准确；
 *  2. 高置信度语义选择器（main/article 等）；
 *  3. 自研评分法（段落/标题加分，导航/链接/图片扣分）兜底。
 *  - 过滤装饰性内容：丢弃 data: 图片、空链接、无 alt 无 title 的装饰图片。
 */
(() => {
  // 高置信度语义选择器（命中即用）
  const SEMANTIC_SELECTORS = [
    'main',
    '[role="main"]',
    'article',
    '[role="article"]'
  ];

  function sanitizeTitle(title) {
    let t = (title || '未命名').replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
    t = t.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return t.slice(0, 80) || '未命名';
  }

  class MarkdownConverter {
    constructor() {
      this.turndown = null;
      this.baseUrl = null;          // 转换抓取到的页面时，用于解析相对链接
      this.keepAllImages = false;   // true 时保留所有图片（含图标/装饰）
    }

    init() {
      if (typeof TurndownService === 'undefined') return false;
      this.turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
        strongDelimiter: '**'
      });
      if (typeof turndownPluginGfm !== 'undefined' && turndownPluginGfm.gfm) {
        this.turndown.use(turndownPluginGfm.gfm);
      }
      this._setupRules();
      return true;
    }

    _resolveUrl(raw) {
      if (!raw) return raw;
      // 未显式设置 baseUrl 时，在 http(s) 页面环境下用当前页面地址兜底（如元素选择器场景）
      let base = this.baseUrl;
      if (!base && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
        base = location.href;
      }
      if (base) {
        try { return new URL(raw, base).href; } catch (_) { return raw; }
      }
      return raw;
    }

    _setupRules() {
      const td = this.turndown;

      td.addRule('strikethrough', {
        filter: ['del', 's', 'strike'],
        replacement: (c) => `~~${c}~~`
      });

      td.addRule('images', {
        filter: 'img',
        replacement: (_c, node) => {
          const alt = node.getAttribute('alt') || '';
          const rawSrc = (node.getAttribute('src') || '').trim();
          const title = node.getAttribute('title') || '';
          // 始终丢弃 data: URI（多为图标/SVG，会严重膨胀文件）
          if (!rawSrc || rawSrc.startsWith('data:')) return '';
          // 默认丢弃无 alt 且无 title 的装饰性图片（logo / 动画 / 图标）
          if (!this.keepAllImages && !alt.trim() && !title.trim()) return '';
          const src = this._resolveUrl(rawSrc);
          const t = title ? ` "${title}"` : '';
          return `![${alt}](${src}${t})`;
        }
      });

      td.addRule('links', {
        filter: (node) => node.nodeName === 'A' && (node.getAttribute('href') || ''),
        replacement: (c, node) => {
          const text = (c == null ? '' : String(c)).trim();
          if (!text) return ''; // 丢弃空链接（如包裹 logo 的站点链接）
          const href = this._resolveUrl(node.getAttribute('href') || '');
          const title = node.getAttribute('title') || '';
          const t = title ? ` "${title}"` : '';
          return `[${c}](${href}${t})`;
        }
      });

      // 代码块：强化识别
      //  - 标准 <pre><code> 结构
      //  - 无 code 子节点的 <pre>（直接文本 / 被高亮 span 包裹 / 外层 figure.highlight 容器）
      //  - 语言探测：class 上的 language-*/lang-*/hljs、data-lang 属性、外层高亮容器
      td.addRule('codeBlock', {
        filter: (node) => {
          if (node.nodeName !== 'PRE') return false;
          // 含 code 子节点或带语言标记 -> 明确代码块
          if (node.querySelector('code')) return true;
          if (this._detectCodeLang(node, node)) return true;
          // 其余 <pre>：无代码特征且几乎全中文时不强转（避免把中文预格式文本当代码）
          const txt = (node.textContent || '').slice(0, 200);
          const hasCodeLike = /[{};=()<>]|=>|\b(function|const|let|var|import|export|def|class|public|private|SELECT|FROM)\b|#!|\$\s/i.test(txt);
          const hasCJK = /[一-鿿]/.test(txt);
          return !(hasCJK && !hasCodeLike);
        },
        replacement: (_c, node) => {
          const codeNode = node.querySelector('code') || node;
          const lang = this._detectCodeLang(node, codeNode);
          let code = codeNode.textContent || '';
          code = code.replace(/^\n+/, '').replace(/\n+$/, '');
          const fence = this._pickFence(code);
          return `\n${fence}${lang}\n${code}\n${fence}\n`;
        }
      });

      td.addRule('inlineCode', {
        filter: (node) => node.nodeName === 'CODE' && !(node.parentNode && node.parentNode.nodeName === 'PRE'),
        replacement: (c) => `\`${c}\``
      });
    }

    /** 移除不需要的节点（脚本/样式/导航/侧边栏/面包屑等） */
    clean(root) {
      if (!root) return root;
      root.querySelectorAll(
        'script, style, noscript, iframe, svg, nav, footer, aside, form, button, ' +
        '[role="navigation"], [role="banner"], [role="search"], [role="complementary"], ' +
        '[class*="sidebar" i], [class*="breadcrumb" i], [class*="cookie" i]'
      ).forEach((n) => n.remove());
      root.querySelectorAll(
        '[style*="display: none"], [style*="display:none"], .hidden, [hidden], [aria-hidden="true"]'
      ).forEach((n) => n.remove());
      this._normalizeTables(root);
      return root;
    }

    /**
     * 规范化表格，保证 GFM 插件能转成 Markdown 管道表格。
     * 解决两类问题：
     *  1. 表头行用 <td>（或 tr[thead="true"]，如火山/飞书等在线文档编辑器）——GFM 插件
     *     判定"无表头"会原样保留 HTML；
     *  2. 单元格内嵌多层编辑器 div（slate/ace 结构），转换后产生大量垃圾标签。
     * 做法：抽取每个单元格的纯文本行，重建成 <thead><th> + <tbody><td> 的简单表格。
     */
    _normalizeTables(root) {
      const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!doc) return;
      // 从内层往外处理，避免嵌套表格互相干扰
      const tables = Array.from(root.querySelectorAll('table')).reverse();
      tables.forEach((table) => {
        const rows = Array.from(table.querySelectorAll('tr'))
          .filter((tr) => tr.closest('table') === table);
        if (!rows.length) { table.remove(); return; }

        const grid = rows.map((tr) =>
          Array.from(tr.children)
            .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
            .map((cell) => ({
              text: this._cellText(cell),
              colspan: Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1)
            }))
        );

        // 表头行：thead 内 / tr[thead="true"] / 含 th 的行，否则默认第一行
        let headerIdx = rows.findIndex((tr) =>
          (tr.parentElement && tr.parentElement.tagName === 'THEAD') ||
          tr.getAttribute('thead') === 'true' ||
          tr.querySelector('th')
        );
        if (headerIdx < 0) headerIdx = 0;

        const nt = doc.createElement('table');
        const thead = doc.createElement('thead');
        const tbody = doc.createElement('tbody');
        grid.forEach((cells, i) => {
          const tr = doc.createElement('tr');
          const tag = i === headerIdx ? 'th' : 'td';
          cells.forEach((c) => {
            const el = doc.createElement(tag);
            el.textContent = c.text; // 纯文本（多行已合并为 <br> 字面量）
            tr.appendChild(el);
            for (let k = 1; k < c.colspan; k++) tr.appendChild(doc.createElement(tag));
          });
          (i === headerIdx ? thead : tbody).appendChild(tr);
        });
        nt.appendChild(thead);
        nt.appendChild(tbody);
        table.replaceWith(nt);
      });
    }

    /** 提取单元格文本：按块级元素分行，去零宽字符，转义管道符，多行用 <br> 字面量连接 */
    _cellText(cell) {
      const ZW = /[\u200b\u200c\u200d\ufeff]/g;
      const blocks = Array.from(cell.querySelectorAll('div, p, li'))
        .filter((b) => !b.querySelector('div, p, li')); // 只取叶子块
      let lines = blocks.length
        ? blocks.map((b) => (b.textContent || '').replace(ZW, '').trim())
        : [(cell.textContent || '').replace(ZW, '').trim()];
      lines = lines.filter(Boolean);
      return lines.map((s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ')).join('<br>');
    }

    /** 探测代码块语言：class（language-/lang-/hljs）、data-lang 属性、外层高亮容器 */
    _detectCodeLang(pre, codeNode) {
      const classSrc = [];
      const push = (el) => { if (el && el.className) classSrc.push(el.className); };
      push(pre);
      push(codeNode);
      const p = pre && pre.parentElement;
      if (p) { push(p); if (p.parentElement) push(p.parentElement); }
      const joined = classSrc.join(' ');
      // 1) 常见高亮库：language-js / lang-js / hljs language-js / highlight-source-python
      const m = joined.match(/(?:language|lang)[-_]([\w+#.-]+)/i) ||
                joined.match(/highlight-source-([\w+#.-]+)/i);
      if (m) {
        const lang = m[1].toLowerCase();
        if (lang && lang !== 'hljs' && lang !== 'highlight') return lang;
      }
      // 2) data-lang 属性（pre 或 code 上）
      const dl = (pre.getAttribute && pre.getAttribute('data-lang')) ||
                 (codeNode.getAttribute && codeNode.getAttribute('data-lang'));
      if (dl && dl.trim()) return dl.trim().toLowerCase();
      return '';
    }

    /** 选取代码围栏：内容含 ``` 时改用 ~~~ 避免提前闭合 */
    _pickFence(code) {
      return code.indexOf('```') !== -1 ? '~~~' : '```';
    }

    convertElement(el) {
      if (!this.turndown) throw new Error('转换器未初始化');
      if (!el) return '';
      const clone = el.cloneNode(true);
      this.clean(clone);
      return this.turndown.turndown(clone)
        .replace(/[\u200b\u200c\u200d\ufeff]/g, '')   // 零宽字符（在线文档编辑器常见）
        .replace(/\n{3,}/g, '\n\n')                    // 折叠多余空行
        .trim();
    }

    /** 文本长度（去零宽/空白），用于比较两种提取结果 */
    _textLen(el) {
      if (!el) return 0;
      return (el.textContent || '').replace(/[\u200b\u200c\u200d\ufeff\s]/g, '').length;
    }

    /**
     * 选择正文：Readability 与 语义/评分法 各提取一次；
     * 若 Readability 结果明显偏短（< 备选的 1/2），说明它截丢了内容
     * （常见于在线文档编辑器页面：正文是 div 行而非 <p>），改用备选。
     */
    _pickMain(doc, baseUrl) {
      const r = this._extractWithReadability(doc, baseUrl);
      const f = this.findMainContent(doc);
      if (!r) return f;
      if (f && this._textLen(f) > this._textLen(r) * 2) return f;
      return r;
    }

    /** 从 HTML 字符串转换（用于抓取的页面），返回 {markdown, title} */
    convertHTMLString(html, baseUrl) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      this.baseUrl = baseUrl || null;
      const title = (doc.title || '').trim();
      const main = this._pickMain(doc, baseUrl);
      const markdown = this.convertElement(main);
      this.baseUrl = null;
      return { markdown, title };
    }

    /**
     * 用 Mozilla Readability 提取正文。
     * 成功返回一个包含正文 HTML 的 <div>；失败/内容过短返回 null（由调用方降级）。
     * 注意：Readability 会破坏性修改 DOM，因此在克隆文档上运行。
     */
    _extractWithReadability(doc, baseUrl) {
      if (typeof Readability === 'undefined' || !doc || !doc.documentElement) return null;
      try {
        const clone = doc.cloneNode(true);
        // 注入 <base>：让 Readability 的相对链接解析（_fixRelativeUris）以原页面为基准，
        // 否则 DOMParser 文档的 baseURI 是扩展自身地址。
        if (baseUrl && !clone.querySelector('base[href]')) {
          const head = clone.head || clone.documentElement;
          const base = clone.createElement('base');
          base.setAttribute('href', baseUrl);
          head.insertBefore(base, head.firstChild);
        }
        const article = new Readability(clone, {
          charThreshold: 200,     // 低于默认 500，避免短文被误判为"不可读"
          keepClasses: true,      // 保留 class（如 language-xxx，供代码块语言识别）
          nbTopCandidates: 5
        }).parse();
        if (!article || !article.content) return null;
        if ((article.textContent || '').trim().length < 200) return null;
        const container = doc.createElement('div');
        container.innerHTML = article.content;
        return container;
      } catch (_) {
        return null; // 任何异常（含 CSP/Trusted Types 限制）都静默降级
      }
    }

    /** 评分：正文特征（段落/标题/文本）加分，导航特征（链接/图片/nav/header）扣分 */
    _scoreContent(el) {
      const text = (el.textContent || '').trim().length;
      if (text < 200 || text > 500000) return 0;
      let p = el.querySelectorAll('p').length;
      // 在线文档编辑器（飞书/火山等）正文是叶子 div 行而非 <p>，把它们视作段落
      if (p < 3) {
        try {
          const leaf = Array.from(el.querySelectorAll('div:not(:has(div, p, table, ul, ol))'))
            .filter((d) => (d.textContent || '').trim().length > 30).length;
          p = Math.max(p, Math.min(leaf, 200));
        } catch (_) { /* 环境不支持 :has 则忽略 */ }
      }
      const headings = el.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
      const li = el.querySelectorAll('li').length;
      const a = el.querySelectorAll('a').length;
      const img = el.querySelectorAll('img').length;
      const navish = el.querySelectorAll(
        'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="search"], [role="complementary"]'
      ).length;
      let score = text / 50 + p * 60 + headings * 25 + li * 4;
      score -= navish * 300;        // 含导航/页头/页脚的外壳容器扣分
      score -= img * 25;            // 图片多扣分（logo/图标密集区）
      const linkDensity = a / Math.max(p + headings, 1);
      if (linkDensity > 2) score -= linkDensity * 50; // 链接密度高 -> 像导航
      return score;
    }

    /** 在 document 中查找主要内容区块 */
    findMainContent(doc) {
      // 1. 高置信度语义选择器
      for (const sel of SEMANTIC_SELECTORS) {
        const el = doc.querySelector(sel);
        if (el && (el.textContent || '').trim().length > 200) return el;
      }
      // 2. 评分选择最像正文的容器
      const candidates = doc.querySelectorAll('div, section, article, main');
      let best = null, bestScore = 0;
      candidates.forEach((el) => {
        const score = this._scoreContent(el);
        if (score > bestScore) { bestScore = score; best = el; }
      });
      return best || doc.body;
    }

    /* ===== content script 专用（操作页面 document） ===== */
    convertPage() {
      this.baseUrl = location.href; // 解析页面内相对链接/图片
      try {
        const main = this._pickMain(document, location.href);
        if (!main) throw new Error('无法找到页面内容');
        return this.convertElement(main);
      } finally {
        this.baseUrl = null;
      }
    }

    convertSelection() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) throw new Error('未选中任何内容');
      const range = sel.getRangeAt(0);
      const container = document.createElement('div');
      container.appendChild(range.cloneContents());
      this.baseUrl = location.href;
      try {
        return this.convertElement(container);
      } finally {
        this.baseUrl = null;
      }
    }

    addSourceInfo(md, title, url) {
      const heading = `# ${title || '未命名页面'}\n\n`;
      const source = url ? `> 来源：${url}\n\n` : '';
      return heading + source + md;
    }
  }

  const instance = new MarkdownConverter();
  if (typeof window !== 'undefined') {
    window.MarkdownConverter = MarkdownConverter;
    window.converter = instance;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MarkdownConverter, converter: instance, sanitizeTitle };
  }
})();
