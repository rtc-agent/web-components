/**
 * RTC Agent Theme — Night (Dark)
 *
 * Product brand colors:
 *   - Primary (blue-cyan, soft on dark): #1A7AB0
 *   - Warning (orange planet): #F97802
 *   - Info (blue-cyan): #1A7AB0
 *   - Success (bright green): #4ADE80
 *   - Error (red): #F87171
 *   - Text (moon color): #E8E8E8
 *   - Background (deep night sky): #0B1127
 */
import {css} from 'lit';

export const darkTheme = css`
    :host([theme='dark']) {
        /* Background */
        --rtc-color-bg: #0B1127;
        --rtc-color-bg-secondary: #111B36;
        --rtc-color-bg-tertiary: #1A2548;
        --rtc-color-bg-hover: #1E2D52;
        --rtc-color-bg-active: #253560;

        /* Primary */
        --rtc-color-primary: #1A7AB0;
        --rtc-color-primary-hover: #2290CC;
        --rtc-color-primary-active: #145F8C;
        --rtc-color-primary-rgb: 26 122 176;

        /* Text */
        --rtc-color-text: #E8E8E8;
        --rtc-color-text-secondary: #A0A8C0;
        --rtc-color-text-tertiary: #6B7394;
        --rtc-color-text-inverse: #0B1127;

        /* Border */
        --rtc-color-border: #1E2A4A;
        --rtc-color-border-hover: #2A3860;
        --rtc-color-border-focus: #1A7AB0;

        /* Semantic */
        --rtc-color-success: #4ADE80;
        --rtc-color-warning: #F97802;
        --rtc-color-error: #F87171;
        --rtc-color-info: #1A7AB0;
        --rtc-color-accent: #1A7AB0;

        /* Toolcall header colors (for ID-based hashing, brighter for dark bg) */
        --rtc-color-toolcall-0: #5B7BFF; /* bright blue */
        --rtc-color-toolcall-1: #4ADE80; /* bright green */
        --rtc-color-toolcall-2: #FB923C; /* bright orange */
        --rtc-color-toolcall-3: #C084FC; /* bright purple */
        --rtc-color-toolcall-4: #F87171; /* bright red */
        --rtc-color-toolcall-5: #22D3EE; /* bright cyan */
        --rtc-color-toolcall-6: #F472B6; /* bright pink */
        --rtc-color-toolcall-7: #A3E635; /* bright lime */

        /* Backdrop */
        --rtc-color-backdrop: rgba(11,17,39,0.6);
    }
`;
