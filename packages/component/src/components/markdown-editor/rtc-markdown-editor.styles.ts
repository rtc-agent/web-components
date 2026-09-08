/**
 * Markdown Editor Styles
 *
 * VS Code 风格 Markdown 编辑器样式。
 *
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
 */
import {css} from 'lit';

export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 200px;
        background: var(--rtc-color-bg);
        color: var(--rtc-color-text);
    }

    /* ── Syntax Highlighting Tokens ──
     *
     * highlight.js 主题配色（参考 rtc-message.styles.ts）：
     *   - light 主题：highlight.js github.css
     *   - dark 主题：highlight.js atom-one-dark.css
     */
    :host {
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

    :host([theme='dark']) {
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

    /* ── Editor Content Container ── */
    .editor-content {
        flex: 1;
        display: flex;
        overflow: hidden;
    }

    /* ── Edit Pane ── */
    .edit-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .edit-pane-header {
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-md);
        background: var(--rtc-color-bg-tertiary);
        border-bottom: var(--rtc-border-width) solid var(--rtc-color-border);
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-medium);
        color: var(--rtc-color-text-secondary);
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
    }

    .edit-pane-header::before {
        content: '';
        display: inline-block;
        width: 3px;
        height: 12px;
        background: var(--rtc-color-primary);
        border-radius: 2px;
    }

    .editor-textarea {
        flex: 1;
        width: 100%;
        background: var(--rtc-color-bg);
        color: var(--rtc-color-text);
        border: none;
        padding: var(--rtc-spacing-md);
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-base);
        line-height: var(--rtc-line-height-loose);
        resize: none;
        outline: none;
        tab-size: 2;
    }

    .editor-textarea::placeholder {
        color: var(--rtc-color-text-tertiary);
    }

    .editor-textarea:read-only {
        cursor: default;
    }

    /* ── Split Pane (wa-split-panel) ── */
    .split-container {
        flex: 1;
        display: flex;
        overflow: hidden;
    }

    .split-divider {
        width: 3px;
        background: var(--rtc-color-border);
        cursor: col-resize;
        transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
        flex-shrink: 0;
    }

    .split-divider:hover {
        background: var(--rtc-color-primary);
    }

    .split-divider.dragging {
        background: var(--rtc-color-primary);
    }

    /* ── Preview Pane ── */
    .preview-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .preview-pane-header {
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-md);
        background: var(--rtc-color-bg-tertiary);
        border-bottom: var(--rtc-border-width) solid var(--rtc-color-border);
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-medium);
        color: var(--rtc-color-text-secondary);
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
    }

    .preview-pane-header::before {
        content: '';
        display: inline-block;
        width: 3px;
        height: 12px;
        background: var(--rtc-color-success);
        border-radius: 2px;
    }

    .preview-content {
        flex: 1;
        padding: var(--rtc-spacing-md);
        overflow-y: auto;
        color: var(--rtc-color-text);
        line-height: var(--rtc-line-height-loose);
    }

    /* ── Markdown Preview Styles ── */
    wa-markdown {
        display: block;
    }

    wa-markdown::part(content) {
        color: var(--rtc-color-text);
    }

    /* Markdown 渲染后的样式 */
    .preview-content h1 {
        font-size: var(--rtc-font-size-2xl);
        font-weight: var(--rtc-font-weight-bold);
        margin-bottom: var(--rtc-spacing-md);
        padding-bottom: var(--rtc-spacing-sm);
        border-bottom: var(--rtc-border-width) solid var(--rtc-color-border);
        color: var(--rtc-color-text);
    }

    .preview-content h2 {
        font-size: var(--rtc-font-size-xl);
        font-weight: var(--rtc-font-weight-bold);
        margin-top: var(--rtc-spacing-lg);
        margin-bottom: var(--rtc-spacing-sm);
        color: var(--rtc-color-text);
    }

    .preview-content h3 {
        font-size: var(--rtc-font-size-md);
        font-weight: var(--rtc-font-weight-bold);
        margin-top: var(--rtc-spacing-md);
        margin-bottom: var(--rtc-spacing-xs);
        color: var(--rtc-color-text);
    }

    .preview-content p {
        margin-bottom: var(--rtc-spacing-sm);
    }

    .preview-content code {
        background: var(--rtc-color-bg-tertiary);
        padding: 2px 6px;
        border-radius: var(--rtc-border-radius-sm);
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-sm);
        color: var(--rtc-color-text);
    }

    .preview-content pre {
        background: var(--rtc-syntax-bg);
        padding: var(--rtc-spacing-md);
        border-radius: var(--rtc-border-radius);
        overflow-x: auto;
        margin: var(--rtc-spacing-sm) 0;
    }

    .preview-content pre code {
        background: transparent;
        padding: 0;
        color: var(--rtc-syntax-text);
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-sm);
        line-height: var(--rtc-line-height-loose);
    }

    /* ── highlight.js Syntax Highlighting ── */
    .preview-content .hljs-keyword,
    .preview-content .hljs-selector-tag,
    .preview-content .hljs-literal,
    .preview-content .hljs-section {
        color: var(--rtc-syntax-keyword);
    }

    .preview-content .hljs-function .hljs-keyword {
        color: var(--rtc-syntax-keyword);
    }

    .preview-content .hljs-title,
    .preview-content .hljs-class .hljs-title {
        color: var(--rtc-syntax-title);
    }

    .preview-content .hljs-attr,
    .preview-content .hljs-variable,
    .preview-content .hljs-template-variable {
        color: var(--rtc-syntax-attr);
    }

    .preview-content .hljs-string,
    .preview-content .hljs-meta .hljs-string {
        color: var(--rtc-syntax-string);
    }

    .preview-content .hljs-built_in {
        color: var(--rtc-syntax-built-in);
    }

    .preview-content .hljs-comment,
    .preview-content .hljs-quote {
        color: var(--rtc-syntax-comment);
        font-style: italic;
    }

    .preview-content .hljs-tag,
    .preview-content .hljs-name {
        color: var(--rtc-syntax-tag);
    }

    .preview-content .hljs-section {
        color: var(--rtc-syntax-section);
        font-weight: var(--rtc-font-weight-bold);
    }

    .preview-content .hljs-bullet {
        color: var(--rtc-syntax-bullet);
    }

    .preview-content .hljs-addition {
        background: var(--rtc-syntax-addition-bg);
    }

    .preview-content .hljs-deletion {
        background: var(--rtc-syntax-deletion-bg);
        color: var(--rtc-syntax-deletion);
    }

    .preview-content ul,
    .preview-content ol {
        margin-left: var(--rtc-spacing-lg);
        margin-bottom: var(--rtc-spacing-sm);
    }

    .preview-content blockquote {
        margin: var(--rtc-spacing-sm) 0;
        padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
        border-left: 3px solid var(--rtc-color-primary);
        background: var(--rtc-color-bg-secondary);
        color: var(--rtc-color-text-secondary);
    }

    .preview-content a {
        color: var(--rtc-color-primary);
        text-decoration: none;
    }

    .preview-content a:hover {
        text-decoration: underline;
    }

    .preview-content table {
        width: 100%;
        border-collapse: collapse;
        margin: var(--rtc-spacing-sm) 0;
    }

    .preview-content th,
    .preview-content td {
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        border: var(--rtc-border-width) solid var(--rtc-color-border);
        text-align: left;
    }

    .preview-content th {
        background: var(--rtc-color-bg-secondary);
        font-weight: var(--rtc-font-weight-bold);
    }

    /* ── Task List Checkboxes ── */
    .preview-content input[type='checkbox'] {
        margin-right: var(--rtc-spacing-xs);
        vertical-align: middle;
        cursor: default;
    }

    .preview-content li:has(input[type='checkbox']) {
        list-style: none;
        margin-left: calc(-1 * var(--rtc-spacing-lg));
    }

    /* ── Empty State ── */
    .empty-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--rtc-color-text-tertiary);
        font-size: var(--rtc-font-size-sm);
        font-style: italic;
    }
`;
