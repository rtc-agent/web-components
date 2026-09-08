/**
 * RTC Agent 主题 — 白天（亮色）
 *
 * 产品品牌色：
 *   - 主色（蓝天）：#2741FE
 *   - 警告（橙色行星）：#F97802
 *   - 信息（亮蓝）：#2AC9FF
 *   - 成功（绿色）：#4CAF50
 *   - 错误（红色）：#F44336
 *   - 文字（夜空极深色）：#1A1A2E
 */
import {css} from 'lit';

export const lightTheme = css`
    :host {
        /* 背景 */
        --rtc-color-bg: #FFFFFF;
        --rtc-color-bg-secondary: #F5F5F5;
        --rtc-color-bg-tertiary: #E8E8E8;
        --rtc-color-bg-hover: #EEEEEE;
        --rtc-color-bg-active: #E0E0E0;

        /* 主色 */
        --rtc-color-primary: #2741FE;
        --rtc-color-primary-hover: #4A5FFE;
        --rtc-color-primary-active: #1E35D4;
        --rtc-color-primary-rgb: 39 65 254;

        /* 文字 */
        --rtc-color-text: #1A1A2E;
        --rtc-color-text-secondary: #555570;
        --rtc-color-text-tertiary: #8888A0;
        --rtc-color-text-inverse: #FFFFFF;

        /* 边框 */
        --rtc-color-border: #E0E0E0;
        --rtc-color-border-hover: #D0D0D0;
        --rtc-color-border-focus: #2741FE;

        /* 语义 */
        --rtc-color-success: #4CAF50;
        --rtc-color-warning: #F97802;
        --rtc-color-error: #F44336;
        --rtc-color-info: #2AC9FF;
        --rtc-color-accent: #2741FE;

        /* 遮罩 */
        --rtc-color-backdrop: rgba(0,0,0,0.3);
    }
`;
