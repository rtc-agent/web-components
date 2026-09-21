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
     * Uses inline styles to bypass Lit's style scoping issues with dynamic DOM insertion.
     */
    static create(msg: Message, height: number): HTMLElement {
        const skeletonType = this._getSkeletonType(msg);

        const skeleton = document.createElement('div');
        // Use inline styles for the container
        skeleton.style.cssText = `
            display: flex;
            gap: 12px;
            padding: 12px;
            position: relative;
            overflow: hidden;
            height: ${height}px;
        `;
        skeleton.setAttribute('data-client-id', msg.clientId);

        // Generate internal structure with inline styles
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
     * All styles are inline to bypass Lit's style scoping issues.
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

        // Inline styles
        const avatarStyle = 'width: 36px; height: 36px; border-radius: 50%; background: #e0e0e0; flex-shrink: 0;';

        switch (type) {
            case 'user':
                return `
                    <div style="${avatarStyle}"></div>
                    <div style="flex: 1; background: #e8e8e8; border-radius: 12px; padding: 12px; margin-left: auto; max-width: 70%;">
                        ${this._renderSkeletonLines(finalLineCount, 'right')}
                    </div>
                `;

            case 'assistant':
                return `
                    <div style="${avatarStyle}"></div>
                    <div style="flex: 1; max-width: calc(100% - 48px);">
                        ${this._renderSkeletonLines(finalLineCount, 'left')}
                    </div>
                `;

            case 'toolcall':
                return `
                    <div style="${avatarStyle}"></div>
                    <div style="flex: 1; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                            <div style="width: 20px; height: 20px; border-radius: 4px; background: #d0d0d0;"></div>
                            <div style="height: 16px; width: 120px; background: #d0d0d0; border-radius: 4px;"></div>
                        </div>
                        ${this._renderSkeletonLines(Math.min(5, finalLineCount), 'left')}
                    </div>
                `;

            case 'toolcall-reply':
                return `
                    <div style="${avatarStyle}"></div>
                    <div style="flex: 1; background: #f0f8ff; border: 1px solid #d0e8ff; border-radius: 8px; padding: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <div style="width: 20px; height: 20px; border-radius: 4px; background: #d0d0d0;"></div>
                            <div style="height: 16px; width: 120px; background: #d0d0d0; border-radius: 4px;"></div>
                        </div>
                        ${this._renderSkeletonLines(Math.min(3, finalLineCount), 'left')}
                    </div>
                `;

            case 'error':
                return `
                    <div style="${avatarStyle}"></div>
                    <div style="flex: 1; background: #fff5f5; border: 1px solid #ffd0d0; border-radius: 8px; padding: 12px; display: flex; align-items: center; gap: 8px;">
                        <div style="width: 24px; height: 24px; border-radius: 50%; background: #ffcccc; flex-shrink: 0;"></div>
                        ${this._renderSkeletonLines(Math.min(2, finalLineCount), 'left')}
                    </div>
                `;

            default:
                return this._renderSkeletonLines(finalLineCount, 'left');
        }
    }

    /**
     * Render skeleton lines with varying widths
     * All styles are inline to bypass Lit's style scoping issues.
     */
    private static _renderSkeletonLines(count: number, align: 'left' | 'right'): string {
        const widths =
            align === 'right'
                ? [80, 60, 70, 50, 90] // User messages right-aligned
                : [90, 75, 85, 65, 80]; // Assistant messages left-aligned

        const lineStyle = 'height: 12px; background: #d0d0d0; border-radius: 6px; margin-bottom: 8px;';

        return Array.from({length: count}, (_, i) => {
            const width = widths[i % widths.length];
            return `<div style="${lineStyle} width: ${width}%;"></div>`;
        }).join('');
    }
}
