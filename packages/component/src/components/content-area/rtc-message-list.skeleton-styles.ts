/**
 * Skeleton screen styles for message placeholders
 *
 * Provides shimmer animation and visual structure for skeleton screens.
 * Imported and applied by rtc-message-list component.
 *
 * Phase 4 (I3 fix): Theme-aware colors using CSS custom properties.
 */

import {css} from 'lit';

/**
 * Skeleton screen CSS styles
 */
export const skeletonStyles = css`
    /* Theme-aware skeleton colors */
    :host {
        --skeleton-bg-primary: #e0e0e0;
        --skeleton-bg-secondary: #e8e8e8;
        --skeleton-bg-tertiary: #d0d0d0;
        --skeleton-bg-toolcall: #f5f5f5;
        --skeleton-bg-toolcall-reply: #f0f8ff;
        --skeleton-bg-error: #fff5f5;
        --skeleton-border-toolcall: #e0e0e0;
        --skeleton-border-toolcall-reply: #d0e8ff;
        --skeleton-border-error: #ffd0d0;
        --skeleton-icon-error: #ffcccc;
    }

    /* Dark theme overrides */
    :host([theme='dark']) {
        --skeleton-bg-primary: #3a3a3a;
        --skeleton-bg-secondary: #4a4a4a;
        --skeleton-bg-tertiary: #555555;
        --skeleton-bg-toolcall: #2a2a2a;
        --skeleton-bg-toolcall-reply: #1a2a3a;
        --skeleton-bg-error: #3a1a1a;
        --skeleton-border-toolcall: #4a4a4a;
        --skeleton-border-toolcall-reply: #2a4a6a;
        --skeleton-border-error: #5a2a2a;
        --skeleton-icon-error: #5a3a3a;
    }

    /* Base skeleton style */
    .message-skeleton {
        display: flex;
        gap: 12px;
        padding: 12px;
        position: relative;
        overflow: hidden;
    }

    /* Shimmer animation overlay */
    /* S4: Improved visibility with theme-aware colors */
    .message-skeleton::after {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.08) 20%,
            rgba(255, 255, 255, 0.15) 50%,
            rgba(255, 255, 255, 0.08) 80%,
            transparent 100%
        );
        animation: skeleton-shimmer 1.8s infinite ease-in-out;
    }

    @keyframes skeleton-shimmer {
        0% {
            left: -100%;
        }
        100% {
            left: 100%;
        }
    }

    /* Avatar skeleton (circular placeholder) */
    .skeleton-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--skeleton-bg-primary);
        flex-shrink: 0;
    }

    /* Message bubble skeleton (user messages - right aligned) */
    .skeleton-bubble {
        flex: 1;
        background: var(--skeleton-bg-secondary);
        border-radius: 12px;
        padding: 12px;
        margin-left: auto;
        max-width: 70%;
    }

    /* Content skeleton (assistant messages - left aligned) */
    .skeleton-content {
        flex: 1;
        max-width: calc(100% - 48px);
    }

    /* Skeleton lines (text line placeholders) */
    .skeleton-line {
        height: 12px;
        background: var(--skeleton-bg-tertiary);
        border-radius: 6px;
        margin-bottom: 8px;
        animation: skeleton-pulse 1.5s infinite ease-in-out;
    }

    .skeleton-line:nth-child(odd) {
        animation-delay: 0.2s;
    }

    .skeleton-line:last-child {
        margin-bottom: 0;
    }

    @keyframes skeleton-pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.6;
        }
    }

    /* Tool call skeleton */
    .skeleton-toolcall {
        flex: 1;
        background: var(--skeleton-bg-toolcall);
        border: 1px solid var(--skeleton-border-toolcall);
        border-radius: 8px;
        padding: 12px;
    }

    .skeleton-toolcall-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
    }

    .skeleton-icon {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        background: var(--skeleton-bg-tertiary);
    }

    .skeleton-title {
        height: 16px;
        width: 120px;
        background: var(--skeleton-bg-tertiary);
        border-radius: 4px;
    }

    /* Tool call reply skeleton */
    .skeleton-toolcall-reply {
        flex: 1;
        background: var(--skeleton-bg-toolcall-reply);
        border: 1px solid var(--skeleton-border-toolcall-reply);
        border-radius: 8px;
        padding: 12px;
    }

    .skeleton-reply-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }

    /* Error skeleton */
    .skeleton-error {
        flex: 1;
        background: var(--skeleton-bg-error);
        border: 1px solid var(--skeleton-border-error);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .skeleton-error-icon {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--skeleton-icon-error);
        flex-shrink: 0;
    }
`;
