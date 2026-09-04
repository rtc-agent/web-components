/**
 * Styles for <rtc-message> — message-specific styles only.
 *
 * Shared timeline layout (dot + vertical line) lives in timeline.styles.ts
 * and is composed via `static styles = [timelineStyles, styles]`.
 *
 * This file contains:
 *   - Syntax highlighting tokens (light + dark theme)
 *   - Markdown content styles (code, pre, links, lists, tables)
 *   - Thinking block (collapsible)
 *   - hljs color rules
 */
import {css} from 'lit';
import {timelineStyles} from './timeline.styles.js';

export const styles = [
  timelineStyles,
  css`
    :host {
      display: block;

      /*
       * ── 语法高亮颜色（默认 = github.css light 主题）────────
       *
       * 语义化变量：变量名表示"语法角色"（keyword/string/comment 等），
       * 而不是"颜色名"（red/blue/green 等）。这样切换主题时，
       * 只需要改变量的值，.hljs-* 规则保持不变。
       *
       * 颜色来源：
       *   - light 主题：highlight.js github.css（https://github.com/highlightjs/highlight.js）
       *   - dark 主题：highlight.js atom-one-dark.css
       */
      --rtc-syntax-text: #24292e;
      --rtc-syntax-bg: #ffffff;
      --rtc-syntax-keyword: #d73a49;
      --rtc-syntax-title: #6f42c1;
      --rtc-syntax-attr: #005cc5;
      --rtc-syntax-string: #032f62;
      --rtc-syntax-built-in: #e36209;
      --rtc-syntax-comment: #6a737d;
      --rtc-syntax-tag: #22863a;
      --rtc-syntax-section: #005cc5;
      --rtc-syntax-bullet: #735c0f;
      --rtc-syntax-addition-bg: #f0fff4;
      --rtc-syntax-deletion-bg: #ffeef0;
      --rtc-syntax-deletion: #b31d28;
    }

    /*
     * 暗色主题覆盖。
     *
     * :host-context() 会向上遍历 shadow DOM 边界，匹配到祖先 <rtc-agent> 的
     * theme='dark' 属性（参见 dark.ts 的 :host([theme='dark']) 选择器）。
     *
     * 当 <rtc-agent theme="dark"> 时，下面的变量值生效，所有 .hljs-* 规则
     * 自动切换到 atom-one-dark 配色。
     */
    :host-context([theme='dark']) {
      --rtc-syntax-text: #abb2bf;
      --rtc-syntax-bg: #282c34;
      --rtc-syntax-keyword: #c678dd;
      --rtc-syntax-title: #61aeee;
      --rtc-syntax-attr: #d19a66;
      --rtc-syntax-string: #98c379;
      --rtc-syntax-built-in: #e6c07b;
      --rtc-syntax-comment: #5c6370;
      --rtc-syntax-tag: #e06c75;
      --rtc-syntax-section: #e06c75;
      --rtc-syntax-bullet: #61aeee;
      --rtc-syntax-addition-bg: #1e3a1e;
      --rtc-syntax-deletion-bg: #3a1e1e;
      --rtc-syntax-deletion: #e06c75;
    }

    /*
     * 清除首/末块级元素的纵向 margin，让时间线圆点与第一行文本水平对齐。
     *
     * 选择器解读：.timeline-content > div > *
     *   - .timeline-content     : 组件 render 的内容容器
     *   - > div                 : render 函数里的 <div .innerHTML=...> 包裹层
     *                             （为什么需要这层包裹？见 rtc-message.ts render() 注释）
     *   - > *:first-child       : Markdown 渲染出的首个块级元素（<p>/<h1>/<ul>/...）
     *
     * 浏览器 UA 默认给 <p> 上下各 14px margin，会把首行文本从顶边推开，
     * 与 absolute 定位在 top: 9px 的 .timeline-dot 错位。
     * 这条规则清除掉首个块级元素的 margin-top，让文字从内容区顶边开始。
     */
    .timeline-content > div > *:first-child {
      margin-top: 0;
    }

    .timeline-content > div > *:last-child {
      margin-bottom: 0;
    }

    /*
     * 行内代码。
     *
     * 为什么同时用 background + border？
     *   仅用 background 在暗色主题下对比度不足：
     *     --rtc-color-bg-secondary (#252526) vs --rtc-color-bg (#1e1e1e)
     *     亮度差仅 7 个单位，肉眼几乎分辨不出。
     *   加 1px border（--rtc-color-border #3c3c3c）后，边框与背景有 20+ 单位差，
     *   轮廓清晰。亮色主题下也受益（#e0e0e0 边框 vs #f5f5f5 背景）。
     *
     * 用 --rtc-color-bg-tertiary 而不是 secondary 作为背景，进一步拉开与页面背景距离：
     *   - 亮色：#e8e8e8 vs 页面 #ffffff，差 24
     *   - 暗色：#2d2d30 vs 页面 #1e1e1e，差 15
     */
    .timeline-content code {
      background: var(--rtc-color-bg-tertiary);
      border: 1px solid var(--rtc-color-border);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-xs);
      border-radius: var(--rtc-border-radius-sm);
      font-size: var(--rtc-font-size-sm);
      font-family: var(--rtc-font-family-mono);
    }

    .timeline-content pre {
      background: var(--rtc-syntax-bg);
      padding: var(--rtc-spacing-sm);
      border-radius: var(--rtc-border-radius);
      overflow-x: auto;
      margin: var(--rtc-spacing-sm) 0;
    }

    /*
     * 代码块内的 <code> 取消行内样式（背景/边框/圆角），
     * 由外层 <pre> 接管背景，让 highlight.js 的颜色主导。
     *
     * 这里必须显式 reset border/background，因为上面的 .timeline-content code
     * 同时命中行内代码和代码块内的 <code>，需要后写规则覆盖。
     */
    .timeline-content pre code {
      background: none;
      border: none;
      padding: 0;
      border-radius: 0;
      color: var(--rtc-syntax-text);
      font-family: var(--rtc-font-family-mono);
      font-size: var(--rtc-font-size-sm);
      line-height: var(--rtc-line-height-loose);
    }

    .timeline-content strong {
      font-weight: var(--rtc-font-weight-bold);
    }

    /*
     * 链接：显式使用 --rtc-color-primary token，
     * 避免依赖浏览器默认 <a> 颜色（亮色主题下深蓝 #0000EE 在暗色背景上几乎不可见）。
     *
     * 主题跟随：
     *   - 亮色主题 --rtc-color-primary = #007acc（蓝）
     *   - 暗色主题 --rtc-color-primary = #00d9ff / #007acc（亮青/蓝）
     *
     * 同时加 hover/focus 样式，保持可访问性（键盘 Tab 可见焦点）。
     */
    .timeline-content a {
      color: var(--rtc-color-primary);
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }

    .timeline-content a:hover {
      color: var(--rtc-color-primary-hover, var(--rtc-color-primary));
      text-decoration-thickness: 2px;
    }

    .timeline-content a:focus-visible {
      outline: 2px solid var(--rtc-color-border-focus, var(--rtc-color-primary));
      outline-offset: 2px;
      border-radius: 2px;
    }

    .timeline-content ul,
    .timeline-content ol {
      margin: var(--rtc-spacing-sm) 0;
      padding-left: var(--rtc-spacing-lg);
    }

    .timeline-content li {
      margin: var(--rtc-spacing-xs) 0;
    }

    /*
     * ── 思考内容折叠块 ─────────────────────────────────────────
     *
     * 结构：
     *   .thinking-block
     *     ├── .thinking-header  (可点击，toggle 折叠)
     *     │     ├── .thinking-chevron  (▸/▾ 箭头)
     *     │     └── .thinking-label    ("思考过程" 文字)
     *     └── .thinking-body    (展开时显示，内含 Markdown 渲染的 HTML)
     *
     * 折叠态：只显示 header，body 不渲染（DOM 中不存在）。
     * 展开态：header + body。
     * streaming 期间 label 闪烁，提示内容正在更新。
     */
    .thinking-block {
      border: 1px solid var(--rtc-color-border);
      border-radius: var(--rtc-border-radius);
      overflow: hidden;
    }

    .thinking-header {
      display: flex;
      align-items: center;
      gap: var(--rtc-spacing-xs);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      cursor: pointer;
      user-select: none;
      color: var(--rtc-color-text-tertiary);
      font-size: var(--rtc-font-size-sm);
    }

    .thinking-header:hover {
      background: var(--rtc-color-bg-hover);
    }

    .thinking-chevron {
      display: inline-block;
      width: 1em;
      text-align: center;
      flex-shrink: 0;
    }

    .thinking-label {
      font-style: italic;
    }

    /*
     * streaming 期间 label 闪烁，提示思考内容正在实时到达。
     */
    @keyframes rtc-thinking-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .timeline-item.streaming .thinking-label {
      animation: rtc-thinking-blink 1.5s ease-in-out infinite;
    }

    .thinking-body {
      padding: var(--rtc-spacing-sm);
      border-top: 1px solid var(--rtc-color-border);
      color: var(--rtc-color-text-secondary);
      font-size: var(--rtc-font-size-sm);
    }

    /* thinking body 内的首/末块级元素也清除 margin */
    .thinking-body > div > *:first-child {
      margin-top: 0;
    }

    .thinking-body > div > *:last-child {
      margin-bottom: 0;
    }

    /*
     * ── 语法高亮规则 ────────────────────────────────────────────
     *
     * highlight.js 在代码块内的每个 token 上添加 .hljs-* 类名
     * （例如 .hljs-keyword, .hljs-string）。下面的规则把这些类名
     * 映射到 :host 上定义的 --rtc-syntax-* 变量。
     *
     * 切换主题时只需要改变量值（见 :host-context([theme='dark']) 段），
     * 这些规则保持不变。
     *
     * 类名 → 颜色对照（基于 github.css / atom-one-dark.css）：
     *   keyword        : if / else / return / const / function 等
     *   title          : 函数名、类名
     *   attr/number    : 属性、数字常量
     *   string         : 字符串
     *   built_in       : 内置对象（console / Promise / Array 等）
     *   comment        : 注释
     *   tag            : HTML/SVG 标签名
     *   section        : Markdown 标题
     *   bullet         : 列表标记
     */
    .hljs {
      color: var(--rtc-syntax-text);
      background: var(--rtc-syntax-bg);
    }

    .hljs-doctag,
    .hljs-keyword,
    .hljs-meta .hljs-keyword,
    .hljs-template-tag,
    .hljs-template-variable,
    .hljs-type,
    .hljs-variable.language_ {
      color: var(--rtc-syntax-keyword);
    }

    .hljs-title,
    .hljs-title.class_,
    .hljs-title.class_.inherited__,
    .hljs-title.function_ {
      color: var(--rtc-syntax-title);
    }

    .hljs-attr,
    .hljs-attribute,
    .hljs-literal,
    .hljs-meta,
    .hljs-number,
    .hljs-operator,
    .hljs-variable,
    .hljs-selector-attr,
    .hljs-selector-class,
    .hljs-selector-id {
      color: var(--rtc-syntax-attr);
    }

    .hljs-regexp,
    .hljs-string,
    .hljs-meta .hljs-string {
      color: var(--rtc-syntax-string);
    }

    .hljs-built_in,
    .hljs-symbol {
      color: var(--rtc-syntax-built-in);
    }

    .hljs-comment,
    .hljs-code,
    .hljs-formula {
      color: var(--rtc-syntax-comment);
    }

    .hljs-name,
    .hljs-quote,
    .hljs-selector-tag,
    .hljs-selector-pseudo {
      color: var(--rtc-syntax-tag);
    }

    .hljs-subst {
      color: var(--rtc-syntax-text);
    }

    .hljs-section {
      color: var(--rtc-syntax-section);
      font-weight: bold;
    }

    .hljs-bullet {
      color: var(--rtc-syntax-bullet);
    }

    .hljs-emphasis {
      color: var(--rtc-syntax-text);
      font-style: italic;
    }

    .hljs-strong {
      color: var(--rtc-syntax-text);
      font-weight: bold;
    }

    .hljs-addition {
      color: var(--rtc-syntax-tag);
      background-color: var(--rtc-syntax-addition-bg);
    }

    .hljs-deletion {
      color: var(--rtc-syntax-deletion);
      background-color: var(--rtc-syntax-deletion-bg);
    }

    /* ── Table ─────────────────────────────────────────────────────
     *
     * 极简风格：去掉竖线，只用横线分隔。
     * 斑马纹 + 悬停高亮提升可读性。
     */
    .timeline-content table {
      width: 100%;
      border-collapse: collapse;
      margin: var(--rtc-spacing-sm) 0;
      font-size: var(--rtc-font-size-sm);
      border: 1px solid var(--rtc-color-border);
      border-radius: var(--rtc-border-radius-sm);
      overflow: hidden;
    }

    .timeline-content thead {
      background: var(--rtc-color-bg-secondary);
    }

    .timeline-content th {
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      text-align: left;
      font-weight: var(--rtc-font-weight-semibold, 600);
      color: var(--rtc-color-text);
      border-bottom: 2px solid var(--rtc-color-border);
    }

    .timeline-content td {
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      border-bottom: 1px solid var(--rtc-color-border);
      color: var(--rtc-color-text);
    }

    /* 斑马纹 */
    .timeline-content tbody tr:nth-child(even) {
      background: var(--rtc-color-bg-secondary);
    }

    /* 悬停高亮 */
    .timeline-content tbody tr:hover {
      background: var(--rtc-color-bg-hover);
    }

    /* 最后一行去掉下边框 */
    .timeline-content tbody tr:last-child td {
      border-bottom: none;
    }
  `,
];
