# 网页转 Markdown（含批量转换）

一个 Chrome / Edge（Manifest V3）浏览器扩展，把网页转换为 Markdown。在附件扩展（单页/选区转换）的基础上，**新增批量转换功能**：在页面上框选一段区域，选区内所有文档链接的内容都会被抓取并转换为 Markdown，可「分别下载」每个文件，或「合并为一个文件」下载。

## 功能

- **转换当前页面**：把整页正文转为 Markdown。正文识别三级策略：**Mozilla Readability**（Firefox 阅读模式引擎，首选）→ 语义选择器（`article`/`main`）→ 自研评分法兜底。
- **解除选中/复制限制**（默认开）：覆盖网页常见的 `user-select:none` 及选中、复制、右键事件限制，并兼容 Articulate Storyline 课件的无障碍遮罩；可在扩展弹窗中全局开关。
- **选区 Markdown / 翻译浮窗**：选中普通网页正文后，可在选区附近生成 Markdown，或直接调用用户自己的 Azure Translator 翻译。默认中文译为英语，非中文译为简体中文，两种目标语言均可设置。
- **打包为 ZIP**（默认开，弹窗/批量页可关）：下载时把 Markdown 与其远程图片**打包成一个 `.zip`** 下载（只触发一次下载确认），图片在压缩包内 `images/` 目录、md 链接改写为相对路径。单页为 `auto_html_to_md/<标题>.zip`；批量合并为 `auto_html_to_md/合并文档_<时间戳>.zip`；批量分别下载为 `auto_html_to_md/批量文档_<时间戳>.zip`（每篇一个文件夹，共享 `images/`）。下载失败的图片保留远程链接作为兜底。
- **转换选定区域**：点选页面任意元素即可提取该元素内容（合并原"选区文本"与"元素选择"两个入口）。
- **批量转换选区链接**（核心新增）：
  1. 在页面上选中包含链接的区域；
  2. 打开批量页，自动列出选区内所有去重后的 `http(s)` 链接，可勾选；
  3. 选择输出方式：**分别下载**（每个链接一个 `.md`）或 **合并为一个文件**；
  4. 开始转换，实时显示进度与每条状态（成功/失败）；
  5. 完成后可一键下载，合并模式还提供源码/渲染预览。

## 安装（开发者模式）

1. 打开 Chrome / Edge，地址栏输入 `chrome://extensions`。
2. 右上角打开「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目根目录。
4. 扩展图标出现在工具栏。

## 使用

### 单页 / 选定区域
- 点击扩展图标 → 选择「转换当前页面」或「转换选定区域」（在页面上点击元素即提取）。
- 直接选中文字 → 点击选区附近的「生成 Markdown」或「翻译」。译文在当前网页的浮窗内显示并可复制；输入框、文本域和可编辑区域不会显示浮窗。
- 首次翻译前，在扩展弹窗点击「翻译设置」，填写自己的 Azure Translator Key。全局单服务资源的 Region 可留空；区域或多服务资源须填写 Azure 门户中显示的 Region。
- 如不希望扩展解除网页限制，可在弹窗中关闭「解除网页选中、复制和右键限制」。
- 或右键页面 → 选择对应菜单。
- 快捷键：`Alt+Shift+M`（页面）、`Alt+Shift+S`（选区文本）。
- 结果在预览页打开，可复制或下载。

### 批量转换链接
1. 点击扩展图标 → **批量转换选区链接**：扩展切到源页面进入「框选区域」模式，点击任意容器即拾取其内部所有链接（可连续点击多个区域累积，按 ESC 或右键完成），完成后**自动跳转批量（拓张）页并预填链接**。
   - 也可右键一段已选中的文本 →「批量转换选区内的链接…」：直接读取选区链接打开批量页。
2. 批量页列出链接后，勾选要转换的条目。
3. **框选区域拾取（补充）**：进入批量页后仍可点右上角「🎯 框选区域拾取」继续补充链接，自动并入并去重。
4. 若选区包含文档目录，勾选目录链接并点击「↳ 展开已选目录」：自动收集**同域、位于该目录路径下的一层子链接**，最多 100 个；结果会回到清单供勾选确认。
5. 选择「分别下载」或「合并为一个文件」，按需勾选「添加标题与来源」「自动下载」。
6. 点击「开始批量转换」，等待进度完成。
7. 完成后：分别下载 -> 点「下载全部」；合并 -> 点「下载合并文件」（可预览/复制）。

## 架构

```
manifest.json
├─ background/background.js   服务工作者：菜单/快捷键、单次转换、批量编排、下载、离屏管理
├─ content/content.js         页面脚本：转换、选区浮窗、采集选区链接、元素选择器
├─ content/unlock.js          document_start 页面解锁入口
├─ offscreen/                 离屏文档（MV3）：用 DOMParser + Turndown 解析抓取的 HTML
│  ├─ offscreen.html
│  └─ offscreen.js
├─ popup/                     工具栏弹窗：三个入口
├─ options/                   翻译凭证和默认目标语言设置
├─ batch/                     批量转换页：链接清单、进度、下载、合并预览
├─ preview/                   单次转换预览页：源码/渲染、复制、下载
├─ utils/converter.js         MarkdownConverter：Turndown + GFM，支持 base-URL 解析
├─ utils/selectionFeature.js  选区资格、浮窗定位与解锁控制器
├─ utils/translation.js       语言方向判断与 Azure Translator 请求
├─ utils/imageBundle.js       图片打包：把 md 远程图片抓取为字节，与 md 一起用 JSZip 打包成单个 .zip（preview/batch 复用）
├─ lib/                       turndown.js / turndown-plugin-gfm.js / marked.min.js
├─ styles/styles.css          共享样式
└─ icons/
```

### 批量转换数据流

```
popup「批量转换选区链接」──START_BATCH_PICKER──> background 在源页面注入 startLinkPickerInPage
用户框选并点击区域 ──LINKS_PICKED/LINKS_PICKER_DONE──> background 暂存链接
background 打开 batch.html?tabId ──读 pickedLinksForTab_<tabId>──> 预填清单
（备选）右键选区 ──OPEN_BATCH──> batch.html ──GET_SELECTION_LINKS──> content.js 读取 window.getSelection()
batch.html 展示清单 ──(端口 START: urls, mode)──> background
background 对每个 url：fetch(跨域，凭 host_permissions) ──CONVERT_HTML──> offscreen
offscreen：DOMParser 解析 → 识别正文 → Turndown 转 Markdown → 返回
background 经端口回传 PROGRESS / DONE
batch.html：分别下载(blob) 或 合并下载(blob) + 预览(marked)
```

- 跨域抓取在 **background service worker** 中进行（MV3 下扩展凭 `host_permissions: <all_urls>` 可跨域 fetch）。
- HTML→Markdown 在 **offscreen document** 中进行（service worker 无 `DOMParser`，离屏文档有完整 DOM，并加载 Turndown）。
- 并发抓取（默认 4，可调），单条失败不影响其它，进度实时回传。

## 说明与限制

- 部分站点可能因反爬、需登录、或返回非 HTML（PDF/图片等）导致抓取失败，会在列表中标记为失败。
- 相对链接/图片地址会按页面 URL 解析为绝对地址。
- 抓取时默认携带目标站点 Cookie（`credentials: include`），便于获取登录后可见的内容。
- 批量转换会先用 fetch 抓取服务端 HTML（快）；若内容过短（多为 JS 动态渲染的空壳页面），自动回退到在隐藏标签页中渲染页面后再转换，结果与「单独转换」一致（会短暂出现后台标签页）。
- 框选/选区识别链接已增强：除标准 `<a href>` 外，还会向上查找祖先 `<a>`（点中的常是链接内部的按钮/图标/文字）、识别 `data-href`/`data-url`/`data-route` 等自定义链接属性，以及 `title`/`aria-label`/内联事件中内嵌的 URL（即「鼠标悬停显示链接」的内部平台场景）。
- 翻译 Key 只保存在本机的 `chrome.storage.local`，不会写入项目文件或随扩展分发。网页正文会发送到用户配置的 Azure Translator；请勿在不受信任的共享设备上保存个人 Key。

## 第三方库

- [Readability](https://github.com/mozilla/readability)（Apache-2.0）— 正文提取（Firefox 阅读模式引擎）
- [Turndown](https://github.com/mixmark-io/turndown)（MIT）— HTML → Markdown
- [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm)（MIT）— 表格/任务列表
- [marked](https://github.com/markedjs/marked)（MIT）— Markdown → HTML 预览
