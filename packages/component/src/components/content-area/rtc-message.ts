/**
 * RTC Message Component
 *
 * Renders a single AI message with timeline dot and Markdown content.
 * Supports thinking, streaming, and success states.
 *
 * Markdown parsing is lazy-loaded (Lit best-practice 7-3).
 *
 * ## Layout model (时间线布局)
 *
 * DOM 结构：
 *   .timeline-item (position: relative, padding-left 给 dot + 竖线留位)
 *     ├── .timeline-dot          (absolute, 与竖线共享 left 参考系)
 *     ├── ::before               (竖线, 绝对定位伪元素)
 *     └── .timeline-content
 *           └── div              (rendered-HTML 包裹层)
 *                 └── <p>/<h1>/... (Markdown 渲染出的块级元素)
 *
 * 对齐原理（详见 rtc-message.styles.ts 注释）：
 *   - 竖线 center X = 15px（left: 14px + width 2px 的一半）
 *   - dot center X    = 15px（left: 15px + translateX(-50%)）
 *   - dot center Y    ≈ 首行文本行高中点 Y（top: 9px，基于默认 token 计算）
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
import type {Message} from '../../types/index.js';
import {copyToClipboard} from '../../utils/clipboard.js';
import {formatTimestampCompact, extractTextContent} from '../../utils/format.js';

@localized()
@customElement('rtc-message')
export class RtcMessage extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[RtcMessage] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: Object})
    message: Message = {clientId: '', role: 'assistant', content: {type: 'text', data: ''}, timestamp: 0, syncStatus: 'synced'};

    @property({type: Boolean, attribute: 'is-last'})
    isLast = false;

    /**
     * Markdown 经 marked + DOMPurify 处理后得到的安全 HTML 字符串。
     *
     * 为什么需要这个中间 state，而不是直接渲染 message.content？
     * 1. marked + DOMPurify 通过动态 import 懒加载（首次加载是异步的）
     * 2. 解析结果需要在异步完成后才可用
     * 3. 使用 @state 让结果可用时自动触发重渲染
     */
    @state()
    private _renderedHtml = '';

    /**
     * Thinking 内容的折叠状态。
     *
     * 默认折叠（false）。streaming 期间用户可以手动展开查看实时思考过程，
     * streaming 结束后保持用户的当前选择，不自动切换。
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
        hljs: typeof import('highlight.js').default;
    }> | null = null;

    /**
     * 只在 message 变化时重新解析 Markdown。
     *
     * 为什么不监听所有属性？
     * - isLast 只影响外层 class（success 状态），不影响内容渲染
     * - 监听所有属性会导致 isLast 变化时也重新跑一遍 marked + DOMPurify，浪费性能
     */
    willUpdate(changed: Map<string, unknown>) {
        if (changed.has('message')) {
            this._parseMarkdown();
        }
    }

    private async _parseMarkdown() {
        const contentData = this.message.content;
        const generation = ++this._parseGeneration;

        if (!contentData) {
            this._renderedHtml = '';
            return;
        }

        // Handle different content types — uses shared utility for consistency
        // with clipboard copy operations across message components
        const content = extractTextContent(contentData);

        /*
         * 懒加载 marked + DOMPurify + highlight.js 三件套（首次异步，之后复用）。
         *
         * 为什么三个一起懒加载而不是分开？
         *   它们共同构成"Markdown → 安全 HTML → 着色 HTML"的完整流水线，
         *   任一缺失都无法渲染出最终的彩色消息。首次渲染时一次性加载，
         *   后续只付解析 + 高亮 + 消毒的 CPU 成本，无网络 I/O。
         */
        if (!this._modulesPromise) {
            this._modulesPromise = Promise.all([
                import('marked'),
                import('dompurify'),
                import('highlight.js'),
            ]).then(([markedMod, dompurifyMod, hljsMod]) => ({
                marked: markedMod.marked,
                DOMPurify: dompurifyMod.default,
                hljs: hljsMod.default,
            }));
        }

        const {marked, DOMPurify, hljs} = await this._modulesPromise;

        // Guard: if content changed while we awaited, discard this result.
        if (generation !== this._parseGeneration) return;

        // marked.parse 在异步模式下返回 Promise<string>，同步模式下返回
        // string | undefined。我们调用时未 await，故 cast 为 string；但 DOMPurify
        // 对 null/undefined 输入会抛出 TypeError，所以必须在此处兜底。
        let rawHtml: string;
        try {
            rawHtml = (marked.parse(content) as string) ?? '';
        } catch (err) {
            console.error('[rtc-message] marked.parse failed:', err);
            rawHtml = '';
        }

        // Guard again — parsing is async; content may have changed during parse.
        if (generation !== this._parseGeneration) return;

        // 在 DOMPurify 之前高亮：hljs 添加的 <span class="hljs-*"> 会被保留，
        // 潜在的恶意脚本会被后续 DOMPurify 清除。顺序不能反过来。
        const highlighted = this._highlightCodeBlocks(rawHtml, hljs);

        this._renderedHtml = DOMPurify.sanitize(highlighted);
    }

    /**
     * 对 Markdown 渲染出的所有 <pre><code> 块应用 highlight.js 语法高亮。
     *
     * 流程：
     *   1. DOMParser 把 HTML 字符串解析成 DOM
     *   2. 遍历所有 <pre><code> 元素
     *   3. 调用 hljs.highlightElement()，它会根据 <code> 的 class
     *      （如 language-javascript）选择语言，否则自动检测
     *   4. 序列化回 HTML 字符串
     *
     * 为什么用 DOMParser 而不是正则？
     *   - 正则无法正确处理嵌套标签、HTML 实体、language hint 属性
     *   - DOMParser 由浏览器原生实现，性能足够（代码块不会很大）
     *   - highlight.js 的官方 API 就是面向 DOM 元素的 highlightElement()
     */
    private _highlightCodeBlocks(html: string, hljs: typeof import('highlight.js').default): string {
        if (!html.includes('<pre>')) return html;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el as HTMLElement));
        return doc.body.innerHTML;
    }

    /**
     * 当前消息是否为思考类型（content.type === 'thinking'）。
     * 思考类型消息渲染为可折叠区域，而非直接展示 Markdown。
     */
    private get _isThinkingContent(): boolean {
        return this.message?.content?.type === 'thinking';
    }

    /**
     * 当前消息是否是压缩摘要（content.type === 'summary'）。
     * 压缩摘要渲染为不可折叠的指示块：streaming 态显示"正在压缩"，
     * 完成态显示释放/增加的 token 数。
     */
    private get _isSummaryContent(): boolean {
        return this.message?.content?.type === 'summary';
    }

    private _toggleThinking() {
        this._thinkingExpanded = !this._thinkingExpanded;
    }

    /**
     * 点击 timeline-dot：复制消息内容到剪贴板
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

        /*
         * success 状态条件：
         *   - isLast：只有最后一条消息才显示"完成"绿点
         *   - !streaming：流式传输中不算完成
         *   - 思考类型消息不算"完成"（它是辅助信息，不是最终回复）
         *   - 压缩摘要不算"完成"（它是系统信息，不是最终回复）
         *   - !!content：必须有内容（空消息不算完成）
         */
        const classes = {
            'timeline-item': true,
            streaming: !!message.streaming,
            'thinking-content': isThinking,
            'summary-content': isSummary,
            success: isLast && !message.streaming && !isThinking && !isSummary && !!message.content?.data,
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
              /*
               * 注意这一层额外的 <div> 包裹：
               * 1. .innerHTML 必须挂在某个元素上，不能直接挂在 .timeline-content
               *    上（否则会和 thinking 分支的结构冲突）
               * 2. 这层包裹在 CSS 里被选择器穿透：
               *    `.timeline-content > div > *:first-child { margin-top: 0 }`
               *    用来清除 Markdown 渲染出的首个 <p> 的 UA 默认 margin
               */
              : html`<div .innerHTML=${this._renderedHtml}></div>`}
        </div>
      </div>
    `;
    }

    /**
     * 渲染思考内容块（可折叠）。
     *
     * 折叠态：显示 header 行（chevron + "思考过程"），内容隐藏。
     * 展开态：header 行 + 下方渲染 Markdown 内容。
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
     * 渲染压缩摘要块（不可折叠）。
     *
     * streaming 态：显示"正在压缩上下文..."。
     * 完成态：显示"已压缩上下文 · 释放/增加 X token"。
     *
     * 不再展示压缩后的摘要内容，用户无需阅读；
     * 只关注"正在压缩"和"释放了多少 token"两个信号。
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
     * 从 message.content.data 提取压缩统计信息。
     *
     * 兼容两种数据格式：
     *   - 新格式：SummaryContent { items, metadata }
     *   - 旧格式：SummaryItem[]（无 metadata，返回全 0）
     */
    private _extractSummaryStats() {
        const contentData = this.message?.content?.data as any;
        let metadata: any = null;

        if (contentData && typeof contentData === 'object' && !Array.isArray(contentData)) {
            metadata = contentData.metadata || null;
        }

        return {
            tokensSaved: (metadata?.tokens_before || 0) - (metadata?.tokens_after || 0),
            durationMs: metadata?.duration_ms || 0,
        };
    }

    /**
     * 格式化 token 数量，使用 K/B/T 单位。
     *
     * 规则：
     * - < 1000: 显示原数（如 500）
     * - < 1M: 显示 K（如 12.5K）
     * - < 1B: 显示 M（如 1.5M）
     * - >= 1B: 显示 B（如 2.3B）
     * - >= 1T: 显示 T（如 1.2T）
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
     * 格式化持续时间。
     *
     * 规则：
     * - < 1000ms: 显示 ms（如 500ms）
     * - < 60s: 显示 s（如 3.5s）
     * - >= 60s: 显示 m s（如 2m 30s）
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
