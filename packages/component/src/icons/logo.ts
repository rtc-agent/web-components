/**
 * RTC Agent Logo — 双主题支持
 *
 * 产品 logo 的 Lit 渲染辅助，支持亮色（白天）和暗色（夜晚）两个版本。
 *
 * 使用方式：
 *   import {renderLogo, renderBubbleLogo} from '../../icons/logo.js';
 *   render() { return html`<div class="logo">${renderLogo(this.theme === 'dark')}</div>`; }
 */
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import logoLight from '../assets/logo.svg?raw';
import logoDark from '../assets/logo-dark.svg?raw';

/**
 * 渲染完整 logo（用于登录页、空状态等大尺寸场景）
 *
 * @param dark - `true` 返回夜空版（暗色主题），`false` 返回蓝天版（亮色主题）
 */
export function renderLogo(dark = false): unknown {
    return unsafeHTML(dark ? logoDark : logoLight);
}

/**
 * Bubble logo（最小化气泡）
 *
 * 气泡形状（圆角方形 23.2%）与 logo 同构，直接复用完整 SVG。
 *
 * @param dark - `true` 返回夜空版，`false` 返回蓝天版
 */
export function renderBubbleLogo(dark = false): unknown {
    return unsafeHTML(dark ? logoDark : logoLight);
}
