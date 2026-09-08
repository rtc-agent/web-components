/**
 * RTC Agent 主题 — 夜晚（暗色）
 *
 * 产品品牌色：
 *   - 主色（蓝青，深底柔和）：#1A7AB0
 *   - 警告（橙色行星）：#F97802
 *   - 信息（蓝青）：#1A7AB0
 *   - 成功（亮绿）：#4ADE80
 *   - 错误（红色）：#F87171
 *   - 文字（月亮色）：#E8E8E8
 *   - 背景（夜空极深色）：#0B1127
 */
import {css} from 'lit';

export const darkTheme = css`
    :host([theme='dark']) {
        /* 背景 */
        --rtc-color-bg: #0B1127;
        --rtc-color-bg-secondary: #111B36;
        --rtc-color-bg-tertiary: #1A2548;
        --rtc-color-bg-hover: #1E2D52;
        --rtc-color-bg-active: #253560;

        /* 主色 */
        --rtc-color-primary: #1A7AB0;
        --rtc-color-primary-hover: #2290CC;
        --rtc-color-primary-active: #145F8C;
        --rtc-color-primary-rgb: 26 122 176;

        /* 文字 */
        --rtc-color-text: #E8E8E8;
        --rtc-color-text-secondary: #A0A8C0;
        --rtc-color-text-tertiary: #6B7394;
        --rtc-color-text-inverse: #0B1127;

        /* 边框 */
        --rtc-color-border: #1E2A4A;
        --rtc-color-border-hover: #2A3860;
        --rtc-color-border-focus: #1A7AB0;

        /* 语义 */
        --rtc-color-success: #4ADE80;
        --rtc-color-warning: #F97802;
        --rtc-color-error: #F87171;
        --rtc-color-info: #1A7AB0;
        --rtc-color-accent: #1A7AB0;

        /* 遮罩 */
        --rtc-color-backdrop: rgba(11,17,39,0.6);
    }
`;
