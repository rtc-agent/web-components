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
