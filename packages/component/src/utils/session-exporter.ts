// web-components/packages/component/src/utils/session-exporter.ts
/**
 * Session Export to HTML
 *
 * Exports current session conversation to a static HTML file for offline
 * reading, archiving, and sharing. Pure frontend implementation.
 */
import type { Session, Message } from '../types/index.js';

/**
 * Generate a safe filename from session title and creation date.
 *
 * Format: `rtc-{sanitized-title}-{YYYY-MM-DD}.html`
 * - Replaces illegal filename characters with hyphens
 * - Replaces spaces with hyphens
 * - Truncates title to 50 characters
 */
export function generateFilename(session: Session): string {
    const date = new Date(session.createdAt);
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const title = session.title
        .replace(/[<>:"/\\|?*]/g, '-')   // Replace illegal filename chars
        .replace(/\s+/g, '-')             // Replace spaces with hyphens
        .slice(0, 50);                    // Truncate to 50 chars

    return `rtc-${title}-${dateStr}.html`;
}

// Lazy-loaded modules (same pattern as rtc-message.ts:137-156)
// Types match the actual module shapes used in the project.
let markedFn: typeof import('marked').marked | null = null;
let DOMPurifyInstance: typeof import('dompurify').default | null = null;
let hljsInstance: typeof import('./highlight-languages.js').default | null = null;

/**
 * Lazy-load marked + DOMPurify + highlight.js modules.
 *
 * Follows the same dynamic-import caching pattern used in rtc-message.ts.
 * Modules are loaded once and cached for subsequent calls.
 *
 * Key differences from naive import:
 * - marked: extract `.marked` named export from module namespace
 * - DOMPurify: use `.default` (default export), then call `.sanitize()` directly
 * - hljs: use project's `highlight-languages.js` wrapper (pre-registers common languages)
 *   Note: session-exporter.ts is in src/utils/, same dir as highlight-languages.ts
 */
async function loadRenderModules() {
    if (!markedFn) {
        const mod = await import('marked');
        markedFn = mod.marked;
    }
    if (!DOMPurifyInstance) {
        const mod = await import('dompurify');
        DOMPurifyInstance = mod.default;
    }
    if (!hljsInstance) {
        const mod = await import('./highlight-languages.js');
        hljsInstance = mod.default;
    }
    return { marked: markedFn, DOMPurify: DOMPurifyInstance, hljs: hljsInstance };
}

/**
 * Highlight code blocks in rendered HTML using highlight.js.
 *
 * Uses hljs.highlight() (string-input API) for server-side-style rendering.
 * The project's rtc-message.ts uses DOM-based highlightElement(), but for
 * static HTML export we use the string API since we don't have a DOM.
 */
function highlightCodeBlocks(html: string, hljs: NonNullable<typeof hljsInstance>): string {
    return html.replace(/<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g,
        (_match, lang, code) => {
            const decoded = code
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .replace(/&amp;/g, '&');
            try {
                const result = lang && hljs.getLanguage(lang)
                    ? hljs.highlight(decoded, { language: lang })
                    : hljs.highlightAuto(decoded);
                return `<pre><code class="hljs language-${result.language || 'plaintext'}">${result.value}</code></pre>`;
            } catch {
                return `<pre><code>${code}</code></pre>`;
            }
        }
    );
}

/**
 * Render Markdown text to sanitized HTML.
 *
 * Pipeline: marked.parse() → highlight.js → DOMPurify.sanitize()
 * Same pipeline as rtc-message.ts:215-228.
 */
async function renderMarkdown(text: string): Promise<string> {
    const { marked, DOMPurify, hljs } = await loadRenderModules();
    const rawHtml = (marked.parse(text, { breaks: true }) as string) ?? '';
    const highlighted = highlightCodeBlocks(rawHtml, hljs);
    return DOMPurify.sanitize(highlighted);
}

/**
 * Determine if a message should be expanded (shown inline) or collapsed.
 *
 * Expanded: user messages, assistant markdown messages
 * Collapsed: tool calls, thinking, errors, prompts, summaries
 */
export function shouldExpand(message: Message): boolean {
    return (
        message.role === 'user' ||
        (message.role === 'assistant' && message.content.type === 'markdown')
    );
}

/**
 * Render message content to sanitized HTML.
 *
 * - user_message: extract text, render as Markdown → sanitize
 * - markdown: render as Markdown → sanitize
 * - text: escape HTML, render as plain text
 * - toolcall_input/toolcall_output: parse tool data, render as formatted JSON
 * - other types: render as JSON or escaped text in <pre><code>
 *
 * Markdown rendering uses the same pipeline as rtc-message.ts:
 * marked.parse() → highlight.js → DOMPurify.sanitize()
 *
 * Tool call data may be an object or a JSON string (double-serialized).
 * Field name is `tool_name` (not `name`). See rtc-toolcall-card.ts:53-91.
 */
export async function renderMessageContent(message: Message): Promise<string> {
    const { type, data } = message.content;

    switch (type) {
        case 'user_message': {
            const text = (data as { text?: string })?.text ?? '';
            return renderMarkdown(text);
        }
        case 'markdown': {
            const text = typeof data === 'string' ? data : JSON.stringify(data);
            return renderMarkdown(text);
        }
        case 'text': {
            const text = typeof data === 'string' ? data : JSON.stringify(data);
            return escapeHtml(text);
        }
        case 'toolcall_input':
        case 'toolcall_output': {
            // Tool call data may be an object or a JSON string.
            // Field name is `tool_name`. See rtc-toolcall-card.ts.
            // Uses shared parseContentData() for uniform handling.
            const parsed = parseContentData(data);
            const text = parsed ? JSON.stringify(parsed, null, 2) : String(data ?? '');
            return `<pre><code>${escapeHtml(text)}</code></pre>`;
        }
        case 'thinking':
        case 'error':
        case 'prompt': {
            const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            return `<pre><code>${escapeHtml(text)}</code></pre>`;
        }
        case 'summary': {
            // Summary data has two formats:
            // - Old: SummaryItem[] (array)
            // - New: { items?: unknown[], metadata?: { tokens_before, tokens_after, duration_ms? } }
            let displayText: string;
            if (Array.isArray(data)) {
                displayText = JSON.stringify(data, null, 2);
            } else if (data && typeof data === 'object') {
                const summaryData = data as { metadata?: { tokens_before?: number; tokens_after?: number; duration_ms?: number } };
                const meta = summaryData.metadata;
                if (meta) {
                    const saved = (meta.tokens_before ?? 0) - (meta.tokens_after ?? 0);
                    const duration = meta.duration_ms ? `${meta.duration_ms}ms` : 'N/A';
                    displayText = `上下文压缩: 释放 ${saved} tokens, 耗时 ${duration}`;
                } else {
                    displayText = JSON.stringify(data, null, 2);
                }
            } else {
                displayText = String(data ?? '');
            }
            return `<pre><code>${escapeHtml(displayText)}</code></pre>`;
        }
        default: {
            const text = typeof data === 'string' ? data : JSON.stringify(data);
            return escapeHtml(text);
        }
    }
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Parse content data that may be an object or a JSON string.
 *
 * Tool call data from the server may be double-serialized (string within string).
 * This helper handles both cases uniformly.
 * Shared by renderMessageContent() and getPreviewText().
 */
function parseContentData(data: unknown): Record<string, unknown> | null {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data as Record<string, unknown>;
    }
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return typeof parsed === 'object' && parsed !== null ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Generate preview text for collapsed messages.
 *
 * Provides a short, meaningful label for each content type.
 * Tool call field name is `tool_name` (see rtc-toolcall-card.ts:53-91).
 * Uses shared parseContentData() for uniform JSON string/object handling.
 */
export function getPreviewText(message: Message): string {
    const { type, data } = message.content;

    switch (type) {
        case 'toolcall_input': {
            const parsed = parseContentData(data);
            return (parsed?.tool_name as string) || (parsed?.name as string) || 'Tool Call';
        }
        case 'toolcall_output': {
            const parsed = parseContentData(data);
            const toolName = (parsed?.tool_name as string) || (parsed?.name as string) || 'Tool';
            return `${toolName} 结果`;
        }
        case 'thinking':
            return '推理过程';
        case 'error': {
            const parsed = parseContentData(data);
            return (parsed?.title as string) || (parsed?.message as string) || 'Error';
        }
        case 'prompt': {
            const parsed = parseContentData(data);
            return `Prompt: ${(parsed?.name as string) || ''}`;
        }
        case 'summary':
            return '对话摘要';
        default:
            return type;
    }
}

/**
 * Format number with thousand separators.
 */
function formatNumber(num: number | undefined): string {
    if (num === undefined || num === null) return '0';
    return num.toLocaleString('en-US');
}

/**
 * Format timestamp to readable date string.
 */
function formatDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Format message timestamp to time-only string.
 */
function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Generate complete HTML document for session export.
 *
 * Async because renderMessageContent requires lazy-loaded marked/DOMPurify.
 */
export async function generateSessionHTML(session: Session, messages: Message[]): Promise<string> {
    const sessionMeta = `
        <header class="session-header">
            <h1 class="session-title">${escapeHtml(session.title)}</h1>
            <div class="session-meta">
                <span>
                    <span class="meta-label">创建时间</span>
                    <span class="meta-value">${formatDateTime(session.createdAt)}</span>
                </span>
                <span>
                    <span class="meta-label">消息数</span>
                    <span class="meta-value">${messages.length}</span>
                </span>
            </div>
            <div class="token-stats">
                <span class="token-stat">输入 Tokens: <strong>${formatNumber(session.totalInputTokens)}</strong></span>
                <span class="token-stat">输出 Tokens: <strong>${formatNumber(session.totalOutputTokens)}</strong></span>
                <span class="token-stat">缓存读取: <strong>${formatNumber(session.totalCachedReadTokens)}</strong></span>
                <span class="token-stat">缓存写入: <strong>${formatNumber(session.totalCachedWriteTokens)}</strong></span>
                <span class="token-stat">总花费: <strong>$${(session.totalCostUsd ?? 0).toFixed(3)}</strong></span>
            </div>
        </header>
    `;

    // Render all messages (async due to lazy-loaded marked/DOMPurify)
    const renderedMessages = await Promise.all(messages.map(async (msg) => {
        const expanded = shouldExpand(msg);
        const roleClass = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'collapsed';
        const contentClass = expanded ? roleClass : 'collapsed';
        const content = await renderMessageContent(msg);
        const time = formatTime(msg.timestamp);

        if (expanded) {
            return `
                <article class="message ${contentClass}">
                    <div class="message-header">
                        <span class="message-role"><span class="role-dot"></span>${escapeHtml(msg.role)}</span>
                        <time class="message-time">${time}</time>
                    </div>
                    <div class="message-content">${content}</div>
                </article>
            `;
        } else {
            const preview = getPreviewText(msg);
            return `
                <article class="message collapsed">
                    <div class="message-header">
                        <span class="message-role"><span class="role-dot"></span>${escapeHtml(msg.content.type)} <span class="type-badge">${escapeHtml(msg.content.type)}</span></span>
                        <time class="message-time">${time}</time>
                    </div>
                    <details>
                        <summary>${escapeHtml(preview)}</summary>
                        <div class="message-content">${content}</div>
                    </details>
                </article>
            `;
        }
    }));

    const messagesHTML = renderedMessages.join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(session.title)}</title>
    <style>
        :root {
            --bg-user: #eff6ff;
            --bg-assistant: #ffffff;
            --bg-collapsed: #f9fafb;
            --border-color: #e5e7eb;
            --text-primary: #111827;
            --text-secondary: #6b7280;
            --accent-user: #3b82f6;
            --accent-assistant: #10b981;
            --accent-collapsed: #9ca3af;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.7;
            max-width: 880px;
            margin: 0 auto;
            padding: 40px 24px 80px;
            color: var(--text-primary);
            background: #fafafa;
        }

        .session-header {
            background: #fff;
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px 28px;
            margin-bottom: 32px;
            box-shadow: 0 1px 3px rgba(0,0,0,.04);
        }

        .session-title {
            font-size: 22px;
            font-weight: 700;
            margin: 0 0 12px;
            letter-spacing: -0.01em;
        }

        .session-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 20px;
            font-size: 13px;
            color: var(--text-secondary);
        }

        .session-meta span {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .meta-label {
            font-weight: 500;
            color: var(--text-secondary);
        }

        .meta-value {
            color: var(--text-primary);
            font-weight: 500;
        }

        .token-stats {
            display: flex;
            flex-wrap: wrap;
            gap: 6px 16px;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--border-color);
            font-size: 12px;
            color: var(--text-secondary);
        }

        .token-stat {
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }

        .token-stat strong {
            color: var(--text-primary);
            font-variant-numeric: tabular-nums;
        }

        .messages {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .message {
            background: #fff;
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 18px 22px;
            box-shadow: 0 1px 2px rgba(0,0,0,.03);
        }

        .message-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            font-size: 12px;
            color: var(--text-secondary);
        }

        .message-role {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-size: 11px;
        }

        .role-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .message.user .role-dot { background: var(--accent-user); }
        .message.assistant .role-dot { background: var(--accent-assistant); }
        .message.collapsed .role-dot { background: var(--accent-collapsed); }

        .message-time {
            font-size: 12px;
            color: var(--text-secondary);
            font-variant-numeric: tabular-nums;
        }

        .message.user {
            background: var(--bg-user);
            border-color: #bfdbfe;
        }

        .message.assistant {
            background: var(--bg-assistant);
        }

        .message-content {
            font-size: 14.5px;
            word-break: break-word;
        }

        .message-content p { margin: 0 0 10px; }
        .message-content p:last-child { margin-bottom: 0; }

        .message-content h1,
        .message-content h2,
        .message-content h3,
        .message-content h4 {
            margin: 16px 0 8px;
            line-height: 1.3;
        }
        .message-content h1 { font-size: 20px; }
        .message-content h2 { font-size: 17px; }
        .message-content h3 { font-size: 15px; }
        .message-content h4 { font-size: 14px; }

        .message-content ul, .message-content ol {
            padding-left: 24px;
            margin: 8px 0;
        }

        .message-content li { margin-bottom: 4px; }

        .message-content a {
            color: var(--accent-user);
            text-decoration: none;
        }
        .message-content a:hover { text-decoration: underline; }

        .message-content pre {
            background: #f3f4f6;
            border: 1px solid var(--border-color);
            padding: 14px 16px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 10px 0;
            font-size: 13px;
            line-height: 1.55;
        }

        .message-content code {
            font-family: "SF Mono", "Fira Code", Monaco, Consolas, monospace;
            font-size: 0.92em;
        }

        .message-content :not(pre) > code {
            background: #f3f4f6;
            padding: 2px 5px;
            border-radius: 4px;
        }

        .message-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 12px 0;
            font-size: 13.5px;
        }

        .message-content th, .message-content td {
            border: 1px solid var(--border-color);
            padding: 8px 12px;
            text-align: left;
        }

        .message-content th {
            background: #f9fafb;
            font-weight: 600;
        }

        .message-content blockquote {
            border-left: 3px solid var(--border-color);
            padding-left: 14px;
            color: var(--text-secondary);
            margin: 10px 0;
        }

        .message.collapsed {
            background: var(--bg-collapsed);
            border-color: #e5e7eb;
        }

        .message.collapsed details {
            margin-top: 4px;
        }

        .message.collapsed details summary {
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-secondary);
            padding: 4px 0;
            list-style: none;
            display: flex;
            align-items: center;
            gap: 6px;
            user-select: none;
        }

        .message.collapsed details summary::-webkit-details-marker { display: none; }

        .message.collapsed details summary::before {
            content: "▸";
            font-size: 11px;
            transition: transform .15s ease;
            flex-shrink: 0;
        }

        .message.collapsed details[open] summary::before {
            transform: rotate(90deg);
        }

        .message.collapsed details summary:hover {
            color: var(--text-primary);
        }

        .message.collapsed details[open] summary {
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
        }

        .message.collapsed details .message-content {
            font-size: 13.5px;
            color: #374151;
        }

        .type-badge {
            display: inline-block;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 2px 6px;
            border-radius: 4px;
            background: #e5e7eb;
            color: #6b7280;
            margin-left: 4px;
            vertical-align: middle;
        }

        @media print {
            body { background: #fff; padding: 20px; }
            .message { box-shadow: none; break-inside: avoid; }
            .session-header { box-shadow: none; }
            details[open] summary ~ .message-content { display: block !important; }
        }
    </style>
</head>
<body>
    ${sessionMeta}
    <main class="messages">
        ${messagesHTML}
    </main>
</body>
</html>`;
}

/**
 * Trigger browser download of HTML content.
 */
export function triggerDownload(html: string, filename: string): void {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Export session to HTML file.
 *
 * Main entry point: generates HTML and triggers download.
 * Async because generateSessionHTML requires lazy-loaded marked/DOMPurify.
 */
export async function exportSession(session: Session, messages: Message[]): Promise<void> {
    const html = await generateSessionHTML(session, messages);
    const filename = generateFilename(session);
    triggerDownload(html, filename);
}
