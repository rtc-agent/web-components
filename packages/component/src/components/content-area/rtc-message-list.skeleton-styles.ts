/**
 * Skeleton screen styles for message placeholders
 *
 * Provides shimmer animation and visual structure for skeleton screens.
 * Imported and applied by rtc-message-list component.
 */

import {css} from 'lit';

/**
 * Skeleton screen CSS styles
 */
export const skeletonStyles = css`
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
        background: #e0e0e0;
        flex-shrink: 0;
    }

    /* Message bubble skeleton (user messages - right aligned) */
    .skeleton-bubble {
        flex: 1;
        background: #e8e8e8;
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
        background: #d0d0d0;
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
        background: #f5f5f5;
        border: 1px solid #e0e0e0;
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
        background: #d0d0d0;
    }

    .skeleton-title {
        height: 16px;
        width: 120px;
        background: #d0d0d0;
        border-radius: 4px;
    }

    /* Tool call reply skeleton */
    .skeleton-toolcall-reply {
        flex: 1;
        background: #f0f8ff;
        border: 1px solid #d0e8ff;
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
        background: #fff5f5;
        border: 1px solid #ffd0d0;
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
        background: #ffcccc;
        flex-shrink: 0;
    }
`;
