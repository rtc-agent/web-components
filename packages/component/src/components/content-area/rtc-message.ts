/**
 * RTC Message Component
 *
 * Renders a single AI message with timeline dot and Markdown content.
 * Supports thinking, streaming, and success states.
 *
 * Markdown parsing is lazy-loaded (Lit best-practice 7-3).
 *
 * ## Layout model (Timeline layout)
 *
 * DOM structure:
 *   .timeline-item (position: relative, padding-left reserves space for dot + vertical line)
 *     ├── .timeline-dot          (absolute, shares left reference frame with the vertical line)
 *     ├── ::before               (vertical line, absolutely positioned pseudo-element)
 *     └── .timeline-content
 *           └── div              (rendered-HTML wrapper layer)
 *                 └── <p>/<h1>/... (block-level elements produced by Markdown rendering)
 *
 * Alignment principle (see rtc-message.styles.ts comments for details):
 *   - vertical line center X = 15px (left: 14px + half of width 2px)
 *   - dot center X             = 15px (left: 15px + translateX(-50%))
 *   - dot center Y             ≈ first-line text line-height midpoint Y (top: 9px, based on default token calculation)
 *
 * @element rtc-message
 * @csspart dot - The timeline dot
 * @csspart content - The message content area
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {classMap} from 'lit/directives/class-map.js';
import {styles} from './rtc-message.styles.js';
import type {Message, PromptContent} from '../../types/index.js';
import {copyToClipboard} from '../../utils/clipboard.js';
import {formatTimestampCompact, extractTextContent} from '../../utils/format.js';
import { createLogger } from '@rtc-agent/client';
import type {StatefulComponent} from '../../utils/message-virtual-scroll.js';

const log = createLogger('Message');

@localized()
@customElement('rtc-message')
export class RtcMessage extends LitElement implements StatefulComponent {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: Object})
    message: Message = {clientId: '', role: 'assistant', content: {type: 'text', data: ''}, timestamp: 0, syncStatus: 'synced'};

    @property({type: Boolean, attribute: 'is-last'})
    isLast = false;

    /**
     * Safe HTML string produced by processing Markdown through marked + DOMPurify.
     *
     * Why is this intermediate @state needed instead of rendering message.content directly?
     * 1. marked + DOMPurify are lazy-loaded via dynamic import (first load is async)
     * 2. Parse results are only available after async completion
     * 3. Using @state triggers automatic re-render when results become available
     */
    @state()
    private _renderedHtml = '';

    /**
     * Collapse state for thinking content.
     *
     * Default collapsed (false). During streaming, user can manually expand to view
     * real-time thinking process. After streaming ends, the user's current choice
     * is preserved without automatic switching.
     */
    @state()
    private _thinkingExpanded = false;

    /**
     * Generation counter — ensures stale parse results (from earlier content
     * versions during streaming) never overwrite newer ones. Each call to
     * `_parseMarkdown()` bumps the counter; if the result arrives when the
     * counter has moved on, it is discarded.
     *
     * The marked + dompurify module imports are cached after first load, so
     * subsequent parses only pay for parsing + sanitizing, not network I/O.
     */
    private _parseGeneration = 0;
    private _modulesPromise: Promise<{
        marked: typeof import('marked').marked;
        DOMPurify: typeof import('dompurify').default;
        hljs: typeof import('../../utils/highlight-languages.js').default;
    }> | null = null;

    /**
     * Last parsed content string — used to detect if content actually changed.
     * This prevents unnecessary re-parsing when:
     * 1. Component is restored from skeleton (content unchanged, use cached HTML)
     * 2. Other message fields change (syncStatus, streaming) but content is same
     *
     * Only when content.data changes (streaming updates) do we need to re-parse.
     */
    private _lastParsedContent: string = '';

    /**
     * Only re-parse Markdown when message changes.
     *
     * Why not watch all properties?
     * - isLast only affects outer class (success state), not content rendering
     * - Watching all properties would cause marked + DOMPurify to re-run on isLast changes, wasting performance
     */
    willUpdate(changed: Map<string, unknown>) {
        if (changed.has('message')) {
            // Prompt type doesn't need Markdown parsing, skip to save CPU
            if (this.message.content?.type !== 'prompt') {
                this._parseMarkdown();
            }
        }
    }

    /**
     * Lazy-load marked + DOMPurify + highlight.js with retry logic.
     * Handles stale chunk errors during development (when rebuilds change chunk hashes).
     */
    private async _loadModulesWithRetry(attempts = 2): Promise<{
        marked: typeof import('marked').marked;
        DOMPurify: typeof import('dompurify').default;
        hljs: typeof import('../../utils/highlight-languages.js').default;
    }> {
        try {
            const [markedMod, dompurifyMod, hljsMod] = await Promise.all([
                import('marked'),
                import('dompurify'),
                import('../../utils/highlight-languages.js'),
            ]);
            return {
                marked: markedMod.marked,
                DOMPurify: dompurifyMod.default,
                hljs: hljsMod.default,
            };
        } catch (err) {
            // Dynamic import failed (likely stale chunk hash after rebuild)
            if (attempts > 0) {
                console.warn('[rtc-message] Module load failed, retrying...', err);
                this._modulesPromise = null; // Clear cache to force fresh attempt
                return this._loadModulesWithRetry(attempts - 1);
            }
            console.error('[rtc-message] Module load failed after retries:', err);
            throw err;
        }
    }

    private async _parseMarkdown() {
        const contentData = this.message.content;
        const generation = ++this._parseGeneration;

        if (!contentData) {
            this._renderedHtml = '';
            this._lastParsedContent = '';
            return;
        }

        // Prompt type doesn't need Markdown parsing, skip directly (defensive fallback)
        if (contentData.type === 'prompt') {
            this._renderedHtml = '';
            this._lastParsedContent = '';
            return;
        }

        // Handle different content types — uses shared utility for consistency
        // with clipboard copy operations across message components
        const content = extractTextContent(contentData);

        // Skip parsing if content hasn't changed.
        // This handles two scenarios:
        // 1. Component restored from skeleton: content same as cached, skip re-parse
        // 2. Streaming update: content changed, need to re-parse
        // Without this check, cached _renderedHtml would block streaming updates.
        if (this._renderedHtml && this._lastParsedContent === content) {
            return;
        }

        // Content changed (or first parse), update tracking
        this._lastParsedContent = content;

        /*
         * Lazy-load the marked + DOMPurify + highlight.js trio (first load is async, then reused).
         *
         * Why lazy-load all three together instead of separately?
         *   Together they form the complete "Markdown → safe HTML → highlighted HTML" pipeline.
         *   If any one is missing, the final colored message cannot be rendered. Load them all
         *   in one go on first render; subsequent parses only pay CPU cost for
         *   parsing + highlighting + sanitizing, no network I/O.
         */
        if (!this._modulesPromise) {
            this._modulesPromise = this._loadModulesWithRetry();
        }

        const {marked, DOMPurify, hljs} = await this._modulesPromise;

        // Guard: if content changed while we awaited, discard this result.
        if (generation !== this._parseGeneration) return;

        // marked.parse returns Promise<string> in async mode and
        // string | undefined in sync mode. We call it without await, hence cast to string;
        // but DOMPurify throws TypeError on null/undefined input, so we must guard here.
        let rawHtml: string;
        try {
            rawHtml = (marked.parse(content) as string) ?? '';
        } catch (err) {
            log.error('marked.parse failed:', err);
            rawHtml = '';
        }

        // Guard again — parsing is async; content may have changed during parse.
        if (generation !== this._parseGeneration) return;

        // Highlight before DOMPurify: hljs adds <span class="hljs-*"> which are preserved,
        // while potentially malicious scripts are removed by subsequent DOMPurify. The order cannot be reversed.
        const highlighted = this._highlightCodeBlocks(rawHtml, hljs);

        this._renderedHtml = DOMPurify.sanitize(highlighted);
    }

    /**
     * Apply highlight.js syntax highlighting to all <pre><code> blocks from Markdown rendering.
     *
     * Flow:
     *   1. DOMParser parses HTML string into DOM
     *   2. Iterate all <pre><code> elements
     *   3. Call hljs.highlightElement(), which selects language based on <code>'s class
     *      (e.g. language-javascript), otherwise auto-detects
     *   4. Serialize back to HTML string
     *
     * Why use DOMParser instead of regex?
     *   - Regex cannot correctly handle nested tags, HTML entities, language hint attributes
     *   - DOMParser is natively implemented by the browser, performance is sufficient (code blocks aren't large)
     *   - highlight.js's official API is the DOM-element-oriented highlightElement()
     */
    private _highlightCodeBlocks(html: string, hljs: typeof import('../../utils/highlight-languages.js').default): string {
        if (!html.includes('<pre>')) return html;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el as HTMLElement));
        return doc.body.innerHTML;
    }

    /**
     * Whether the current message is thinking type (content.type === 'thinking').
     * Thinking type messages render as collapsible sections, not direct Markdown display.
     */
    private get _isThinkingContent(): boolean {
        return this.message?.content?.type === 'thinking';
    }

    /**
     * Whether the current message is a compression summary (content.type === 'summary').
     * Compression summaries render as non-collapsible indicator blocks: streaming state shows "compressing",
     * completed state shows released/increased token count.
     */
    private get _isSummaryContent(): boolean {
        return this.message?.content?.type === 'summary';
    }

    /**
     * Whether the current message is prompt type (content.type === 'prompt').
     * Prompt messages render as special cards, not Markdown.
     */
    private get _isPromptContent(): boolean {
        return this.message?.content?.type === 'prompt';
    }

    private _toggleThinking() {
        this._thinkingExpanded = !this._thinkingExpanded;
    }

    // ── StatefulComponent Interface (Phase 2) ──

    /**
     * Extract component state for preservation across virtualization.
     * Called by MessageVirtualScroll before destroying the element.
     *
     * Preserved state:
     * - renderedHtml: Cached Markdown HTML (avoids re-parsing on restore)
     * - thinkingExpanded: User's expand/collapse preference for thinking blocks
     */
    getState(): Record<string, unknown> {
        return {
            renderedHtml: this._renderedHtml,
            thinkingExpanded: this._thinkingExpanded,
        };
    }

    /**
     * Inject cached state after restoring from skeleton placeholder.
     * Called synchronously before first render to avoid flicker.
     *
     * @param state - Previously extracted state from getState()
     */
    setState(state: Record<string, unknown>): void {
        if (state.renderedHtml !== undefined) {
            this._renderedHtml = state.renderedHtml as string;
        }
        if (state.thinkingExpanded !== undefined) {
            this._thinkingExpanded = state.thinkingExpanded as boolean;
        }
    }

    /**
     * On timeline-dot click: copy message content to clipboard
     */
    private async _handleDotClick() {
        const text = extractTextContent(this.message?.content);
        if (!text) return;

        const success = await copyToClipboard(text);
        this.dispatchEvent(new CustomEvent('rtc-toast-requested', {
            bubbles: true,
            composed: true,
            detail: {
                message: success ? msg('已复制到剪贴板') : msg('复制失败'),
                type: success ? 'success' : 'error',
            },
        }));
    }

    render() {
        void this._localeCtx.locale;
        const {message, isLast} = this;
        const isThinking = this._isThinkingContent;
        const isSummary = this._isSummaryContent;
        const isPrompt = this._isPromptContent;

        /*
         * Success state conditions:
         *   - isLast: only the last message shows the "complete" green dot
         *   - !streaming: streaming in progress doesn't count as "complete"
         *   - thinking type messages don't count as "complete" (they are auxiliary info, not final reply)
         *   - compression summaries don't count as "complete" (they are system info, not final reply)
         *   - prompt type doesn't count as "complete" (it is a system prompt, not final reply)
         *   - !!content: must have content (empty messages don't count as complete)
         */
        const classes = {
            'timeline-item': true,
            streaming: !!message.streaming,
            'thinking-content': isThinking,
            'summary-content': isSummary,
            'prompt-content': isPrompt,
            success: isLast && !message.streaming && !isThinking && !isSummary && !isPrompt && !!message.content?.data,
        };

        return html`
      <div class=${classMap(classes)}>
        <div
          class="timeline-dot"
          part="dot"
          data-timestamp=${formatTimestampCompact(this.message.timestamp)}
          @click=${this._handleDotClick}
        ></div>
        <div class="timeline-content" part="content">
          ${isThinking
            ? this._renderThinkingBlock()
            : isSummary
              ? this._renderSummaryBlock()
              : isPrompt
                ? this._renderPromptBlock()
                /*
                 * Note this extra layer of <div> wrapping:
                 * 1. .innerHTML must be attached to some element, not directly on .timeline-content
                 *    (otherwise it would conflict with the thinking branch's structure)
                 * 2. This wrapping layer is targeted by CSS selector penetration:
                 *    `.timeline-content > div > *:first-child { margin-top: 0 }`
                 *    used to clear the UA default margin on the first <p> rendered by Markdown
                 */
                : html`<div .innerHTML=${this._renderedHtml}></div>`}
        </div>
      </div>
    `;
    }

    /**
     * Render thinking content block (collapsible).
     *
     * Collapsed state: shows header row (chevron + "Thinking process"), content hidden.
     * Expanded state: header row + Markdown content rendered below.
     */
    private _renderThinkingBlock() {
        const expanded = this._thinkingExpanded;

        return html`
          <div class="thinking-block" data-expanded=${expanded ? '' : undefined}>
            <div class="thinking-header" @click=${this._toggleThinking}>
              <span class="thinking-chevron">${expanded ? '▾' : '▸'}</span>
              <span class="thinking-label">${msg('思考过程')}</span>
            </div>
            ${expanded
              ? html`<div class="thinking-body"><div .innerHTML=${this._renderedHtml}></div></div>`
              : null}
          </div>
        `;
    }

    /**
     * Render compression summary block (non-collapsible).
     *
     * Streaming state: shows "Compressing context...".
     * Completed state: shows "Compressed context · released/increased X tokens".
     *
     * No longer displays the compressed summary content, user doesn't need to read it;
     * only focuses on two signals: "compressing" and "how many tokens were released".
     */
    private _renderSummaryBlock() {
        const isStreaming = !!this.message.streaming;
        const {tokensSaved, durationMs} = this._extractSummaryStats();

        return html`
          <div class="summary-block">
            <div class="summary-header">
              <span class="summary-label">
                ${isStreaming ? msg('正在压缩上下文...') : msg('已压缩上下文')}
              </span>
              ${!isStreaming && tokensSaved !== 0
                ? html`<span class="summary-stats">
                    <span class=${tokensSaved > 0 ? 'summary-tokens-saved' : 'summary-tokens-increased'}>
                      ${tokensSaved > 0 ? msg('释放') : msg('增加')} ${this._formatTokens(Math.abs(tokensSaved))}
                    </span>
                    ${durationMs > 0 ? html`<span class="summary-duration">· ${this._formatDuration(durationMs)}</span>` : null}
                  </span>`
                : null}
            </div>
          </div>
        `;
    }

    /**
     * Render prompt content block (non-collapsible).
     *
     * Display format:
     *   SCENARIOS  $title
     *   [Prompt preview max-height:3 lines]
     *
     * Design decisions:
     * - No expand support: users don't need to read full system prompt content
     * - Uses left border instead of full border: visually lighter (distinguished from summary-block's full border)
     * - Preview area limited to 3 lines: saves space
     * - Uses <pre> to render prompt text: preserves original formatting (line breaks, indentation),
     *   while avoiding HTML injection (prompt content may contain < and > characters)
     * - Automatically supports dark theme (uses --rtc-* CSS variables)
     */
    private _renderPromptBlock() {
        const contentData = this.message?.content?.data as PromptContent | undefined;
        if (!contentData) return html``;

        const {name, title, prompt} = contentData;
        const displayName = name.toUpperCase();

        return html`
            <div class="prompt-block" part="prompt">
                <div class="prompt-header">
                    <span class="prompt-name">${displayName}</span>
                    ${title ? html`<span class="prompt-title">${title}</span>` : null}
                </div>
                <pre class="prompt-preview">${prompt}</pre>
            </div>
        `;
    }

    /**
     * Extract compression statistics from message.content.data.
     *
     * Compatible with two data formats:
     *   - New format: SummaryContent { items, metadata }
     *   - Old format: SummaryItem[] (no metadata, returns all zeros)
     */
    private _extractSummaryStats() {
        const contentData = this.message?.content?.data as Record<string, unknown> | undefined;
        let metadata: Record<string, number> | null = null;

        if (contentData && typeof contentData === 'object' && !Array.isArray(contentData)) {
            metadata = (contentData.metadata as Record<string, number>) || null;
        }

        return {
            tokensSaved: (metadata?.tokens_before || 0) - (metadata?.tokens_after || 0),
            durationMs: metadata?.duration_ms || 0,
        };
    }

    /**
     * Format token count using K/B/T units.
     *
     * Rules:
     * - < 1000: show raw number (e.g. 500)
     * - < 1M: show K (e.g. 12.5K)
     * - < 1B: show M (e.g. 1.5M)
     * - >= 1B: show B (e.g. 2.3B)
     * - >= 1T: show T (e.g. 1.2T)
     */
    private _formatTokens(tokens: number): string {
        if (tokens < 1000) {
            return `${tokens}`;
        } else if (tokens < 1_000_000) {
            const k = tokens / 1000;
            return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`;
        } else if (tokens < 1_000_000_000) {
            const m = tokens / 1_000_000;
            return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
        } else if (tokens < 1_000_000_000_000) {
            const b = tokens / 1_000_000_000;
            return b >= 100 ? `${Math.round(b)}B` : `${b.toFixed(1)}B`;
        } else {
            const t = tokens / 1_000_000_000_000;
            return `${t.toFixed(1)}T`;
        }
    }

    /**
     * Format duration.
     *
     * Rules:
     * - < 1000ms: show ms (e.g. 500ms)
     * - < 60s: show s (e.g. 3.5s)
     * - >= 60s: show m s (e.g. 2m 30s)
     */
    private _formatDuration(ms: number): string {
        if (ms < 1000) {
            return `${ms}ms`;
        } else if (ms < 60_000) {
            const s = ms / 1000;
            return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
        } else {
            const m = Math.floor(ms / 60_000);
            const s = Math.round((ms % 60_000) / 1000);
            return s > 0 ? `${m}m ${s}s` : `${m}m`;
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-message': RtcMessage;
    }
}
