/**
 * Skeleton screen generator for message placeholders
 *
 * Generates type-specific skeleton structures (user, assistant, toolcall, etc.)
 * using pure DOM elements (no Lit component overhead).
 *
 * Inspired by Telegram's placeholder approach - provides visual continuity
 * while messages are being virtualized.
 */

import type {Message} from '../types/index.js';

/**
 * Skeleton screen generator for message placeholders
 */
export class MessageSkeletonGenerator {
    /**
     * Generate a skeleton placeholder by type
     */
    static generate(
        type: 'user' | 'assistant' | 'toolcall' | 'toolcall-reply' | 'error',
        height: number
    ): string {
        return this._renderSkeletonContent(type, height);
    }

    /**
     * Create a skeleton placeholder for a message (convenience method)
     */
    static create(msg: Message, height: number): HTMLElement {
        const skeletonType = this._getSkeletonType(msg);

        const skeleton = document.createElement('div');
        skeleton.className = `message-skeleton message-skeleton-${skeletonType}`;
        skeleton.style.height = `${height}px`;
        skeleton.setAttribute('data-client-id', msg.clientId);

        // Generate internal structure based on type
        skeleton.innerHTML = this.generate(skeletonType, height);

        return skeleton;
    }

    /**
     * Determine skeleton type based on message type
     */
    private static _getSkeletonType(
        msg: Message
    ): 'user' | 'assistant' | 'toolcall' | 'toolcall-reply' | 'error' {
        if (msg.role === 'user') return 'user';
        if (msg.content?.type === 'error') return 'error';
        if (msg.content?.type === 'toolcall_input') return 'toolcall';
        if (msg.content?.type === 'toolcall_output') return 'toolcall-reply';
        return 'assistant';
    }

    /**
     * Render skeleton content based on type
     */
    private static _renderSkeletonContent(type: string, height: number): string {
        // Visual bounds: prevent excessive line count
        const maxLines = 20; // Absolute upper limit
        const maxLineRatio = 0.8; // Max 80% of height as lines
        const lineHeight = 20; // Each line is 20px

        const linesByHeight = Math.floor(height / lineHeight);
        const linesByRatio = Math.floor((height * maxLineRatio) / lineHeight);
        const lineCount = Math.min(linesByHeight, linesByRatio, maxLines);

        // At least 1 line
        const finalLineCount = Math.max(1, lineCount);

        switch (type) {
            case 'user':
                return `
                    <div class="skeleton-avatar"></div>
                    <div class="skeleton-bubble">
                        ${this._renderSkeletonLines(finalLineCount, 'right')}
                    </div>
                `;

            case 'assistant':
                return `
                    <div class="skeleton-avatar"></div>
                    <div class="skeleton-content">
                        ${this._renderSkeletonLines(finalLineCount, 'left')}
                    </div>
                `;

            case 'toolcall':
                return `
                    <div class="skeleton-avatar"></div>
                    <div class="skeleton-toolcall">
                        <div class="skeleton-toolcall-header">
                            <div class="skeleton-icon"></div>
                            <div class="skeleton-title"></div>
                        </div>
                        ${this._renderSkeletonLines(Math.min(5, finalLineCount), 'left')}
                    </div>
                `;

            case 'toolcall-reply':
                return `
                    <div class="skeleton-avatar"></div>
                    <div class="skeleton-toolcall-reply">
                        <div class="skeleton-reply-header">
                            <div class="skeleton-icon"></div>
                            <div class="skeleton-title"></div>
                        </div>
                        ${this._renderSkeletonLines(Math.min(3, finalLineCount), 'left')}
                    </div>
                `;

            case 'error':
                return `
                    <div class="skeleton-avatar"></div>
                    <div class="skeleton-error">
                        <div class="skeleton-error-icon"></div>
                        ${this._renderSkeletonLines(Math.min(2, finalLineCount), 'left')}
                    </div>
                `;

            default:
                return this._renderSkeletonLines(finalLineCount, 'left');
        }
    }

    /**
     * Render skeleton lines with varying widths
     */
    private static _renderSkeletonLines(count: number, align: 'left' | 'right'): string {
        const widths =
            align === 'right'
                ? [80, 60, 70, 50, 90] // User messages right-aligned
                : [90, 75, 85, 65, 80]; // Assistant messages left-aligned

        return Array.from({length: count}, (_, i) => {
            const width = widths[i % widths.length];
            return `<div class="skeleton-line" style="width: ${width}%"></div>`;
        }).join('');
    }
}
