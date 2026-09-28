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
       * ── Syntax highlighting colors (default = github.css light theme)────────
       *
       * Semantic variables: variable names represent "syntax roles" (keyword/string/comment etc.),
       * not "color names" (red/blue/green etc.). This way, when switching themes,
       * only the variable values need to change; .hljs-* rules stay unchanged.
       *
       * Color sources:
       *   - light theme: highlight.js github.css (https://github.com/highlightjs/highlight.js)
       *   - dark theme: highlight.js atom-one-dark.css
       */
      --rtc-syntax-text: #24292e;
      --rtc-syntax-bg: #f6f8fa;
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
     * Dark theme overrides.
     *
     * :host-context() walks up through shadow DOM boundaries to match the ancestor
     * <rtc-agent>'s theme='dark' attribute (see dark.ts :host([theme='dark']) selector).
     *
     * When <rtc-agent theme="dark">, the variable values below take effect, and all
     * .hljs-* rules automatically switch to atom-one-dark color scheme.
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
     * Clear vertical margin on first/last block-level elements so the timeline dot
     * aligns horizontally with the first line of text.
     *
     * Selector breakdown: .timeline-content > div > *
     *   - .timeline-content     : component render's content container
     *   - > div                 : the <div .innerHTML=...> wrapper layer in render function
     *                             (why is this wrapper needed? see rtc-message.ts render() comments)
     *   - > *:first-child       : first block-level element produced by Markdown rendering (<p>/<h1>/<ul>/...)
     *
     * Browser UA defaults give <p> 14px margin top and bottom, which pushes the first line
     * away from the top edge, misaligning with the .timeline-dot absolutely positioned at top: 9px.
     * This rule clears the margin-top on the first block-level element, so text starts from the content area top edge.
     */
    .timeline-content > div > *:first-child {
      margin-top: 0;
    }

    .timeline-content > div > *:last-child {
      margin-bottom: 0;
    }

    /*
     * Inline code.
     *
     * Why use both background + border?
     *   Background alone has insufficient contrast in dark theme:
     *     --rtc-color-bg-secondary (#252526) vs --rtc-color-bg (#1e1e1e)
     *     brightness difference is only 7 units, nearly indistinguishable to the eye.
     *   Adding a 1px border (--rtc-color-border #3c3c3c) gives 20+ unit difference from background,
     *   making the outline clear. Light theme also benefits (#e0e0e0 border vs #f5f5f5 background).
     *
     * Uses --rtc-color-bg-tertiary instead of secondary as background, further distancing from page background:
     *   - light: #e8e8e8 vs page #ffffff, difference 24
     *   - dark: #2d2d30 vs page #1e1e1e, difference 15
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
     * Remove inline styles (background/border/border-radius) from <code> inside code blocks,
     * letting the outer <pre> take over background, allowing highlight.js colors to dominate.
     *
     * Here we must explicitly reset border/background because the above .timeline-content code
     * targets both inline code and <code> inside code blocks; the later-written rule needs to override.
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
     * Links: explicitly use --rtc-color-primary token,
     * avoiding reliance on browser default <a> color (in light theme, deep blue #0000EE is nearly invisible on dark backgrounds).
     *
     * Theme following:
     *   - light theme --rtc-color-primary = #2741fe (blue)
     *   - dark theme --rtc-color-primary = #00d9ff / #2741fe (light cyan/blue)
     *
     * Also add hover/focus styles to maintain accessibility (visible focus for keyboard Tab).
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
     * ── Thinking content collapsible block ─────────────────────────────────────────
     *
     * Structure:
     *   .thinking-block
     *     ├── .thinking-header  (clickable, toggles collapse)
     *     │     ├── .thinking-chevron  (▸/▾ arrow)
     *     │     └── .thinking-label    ("Thinking process" text)
     *     └── .thinking-body    (shown when expanded, contains Markdown-rendered HTML)
     *
     * Collapsed state: only shows header, body not rendered (doesn't exist in DOM).
     * Expanded state: header + body.
     * streaming state controlled by parent .timeline-item.streaming for dot pulse animation.
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

    .thinking-body {
      padding: var(--rtc-spacing-sm);
      border-top: 1px solid var(--rtc-color-border);
      color: var(--rtc-color-text-secondary);
      font-size: var(--rtc-font-size-sm);
    }

    /* Clear margin on first/last block-level elements inside thinking body */
    .thinking-body > div > *:first-child {
      margin-top: 0;
    }

    .thinking-body > div > *:last-child {
      margin-bottom: 0;
    }

    /*
     * ── Compression summary block (non-collapsible)────────────────────────────────
     *
     * Structure:
     *   .summary-block
     *     └── .summary-header
     *           ├── .summary-label    ("Compressed context" / "Compressing context...")
     *           └── .summary-stats    (released/increased token count + duration, shown only in completed state)
     *
     * No longer displays the compressed summary content; user only focuses on two signals:
     *   1. Compressing (streaming state, dot pulse controlled by parent .timeline-item.streaming)
     *   2. How many tokens were released/increased (completed state)
     */
    .summary-block {
      border: 1px solid var(--rtc-color-border);
      border-radius: var(--rtc-border-radius);
      overflow: hidden;
      background: var(--rtc-color-bg-secondary);
    }

    .summary-header {
      display: flex;
      align-items: center;
      gap: var(--rtc-spacing-xs);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      color: var(--rtc-color-text-tertiary);
      font-size: var(--rtc-font-size-sm);
    }

    .summary-label {
      font-style: italic;
      flex-shrink: 0;
    }

    .summary-stats {
      display: flex;
      gap: var(--rtc-spacing-xs);
      margin-left: auto;
      color: var(--rtc-color-text-secondary);
      font-size: var(--rtc-font-size-xs);
    }

    .summary-tokens-saved {
      color: var(--rtc-color-success, #10b981);
      font-weight: var(--rtc-font-weight-medium, 500);
    }

    .summary-tokens-increased {
      color: var(--rtc-color-warning, #f59e0b);
      font-weight: var(--rtc-font-weight-medium, 500);
    }

    .summary-duration {
      color: var(--rtc-color-text-tertiary);
    }

    /*
     * ── Syntax highlighting rules ────────────────────────────────────────────
     *
     * highlight.js adds .hljs-* class names to each token inside code blocks
     * (e.g. .hljs-keyword, .hljs-string). The rules below map these class names
     * to the --rtc-syntax-* variables defined on :host.
     *
     * When switching themes, only change the variable values (see :host-context([theme='dark']) section);
     * these rules stay unchanged.
     *
     * Class name → color mapping (based on github.css / atom-one-dark.css):
     *   keyword        : if / else / return / const / function etc.
     *   title          : function names, class names
     *   attr/number    : attributes, numeric literals
     *   string         : strings
     *   built_in       : built-in objects (console / Promise / Array etc.)
     *   comment        : comments
     *   tag            : HTML/SVG tag names
     *   section        : Markdown headings
     *   bullet         : list markers
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
     * Minimalist style: remove vertical lines, use only horizontal lines for separation.
     * Zebra striping + hover highlighting for better readability.
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

    /* Zebra striping */
    .timeline-content tbody tr:nth-child(even) {
      background: var(--rtc-color-bg-secondary);
    }

    /* Hover highlight */
    .timeline-content tbody tr:hover {
      background: var(--rtc-color-bg-hover);
    }

    /* Remove bottom border on last row */
    .timeline-content tbody tr:last-child td {
      border-bottom: none;
    }

    /*
     * ── Prompt content block (non-collapsible)────────────────────────────────
     *
     * Structure:
     *   .prompt-block
     *     ├── .prompt-header
     *     │     ├── .prompt-name    ("SCENARIOS" etc., uppercase)
     *     │     └── .prompt-title   (optional title)
     *     └── pre.prompt-preview    (prompt preview, max 3 lines, <pre> preserves formatting)
     *
     * Design decisions:
     * - Uses left border (border-left: 3px) instead of full border, visually lighter
     *   (creates visual distinction from summary-block's full border)
     * - Preview area limited to 3 lines (via max-height + overflow: hidden)
     * - No expand support (users don't need to read full system prompt content)
     * - Automatically supports dark theme (uses --rtc-* CSS variables, defined by light.ts/dark.ts)
     * - <pre> resets font to inherited value, avoiding browser default monospace font
     */
    .prompt-block {
      border-left: 3px solid var(--rtc-color-primary);
      padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
      background: var(--rtc-color-bg-secondary);
      border-radius: var(--rtc-border-radius);
      margin: var(--rtc-spacing-sm) 0;
    }

    .prompt-header {
      display: flex;
      align-items: baseline;
      gap: var(--rtc-spacing-xs);
      margin-bottom: var(--rtc-spacing-xs);
    }

    .prompt-name {
      font-weight: var(--rtc-font-weight-bold);
      font-size: var(--rtc-font-size-sm);
      color: var(--rtc-color-primary);
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .prompt-title {
      font-size: var(--rtc-font-size-sm);
      color: var(--rtc-color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    pre.prompt-preview {
      font-family: inherit;
      font-size: var(--rtc-font-size-sm);
      line-height: var(--rtc-line-height-base);
      color: var(--rtc-color-text);
      max-height: calc(3 * var(--rtc-line-height-base) * var(--rtc-font-size-sm));
      overflow: hidden;
      margin: 0;
      padding: 0;
      background: none;
      border: none;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `,
];
