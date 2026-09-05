/**
 * Icon System
 *
 * Unified icon management using @primer/octicons.
 * All icons are 16x16 SVGs stored in ./svg/ directory.
 *
 * Usage:
 *   import {minimizeIcon, maximizeIcon} from '../../icons/icons.js';
 *   // or
 *   import {getIcon} from '../../icons/icons.js';
 *   const icon = getIcon('minimize');
 */
import {html} from 'lit';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

// Import all SVG files as raw strings
// Using Vite's ?raw import to get SVG content
import minimizeSvg from './svg/minimize-16.svg?raw';
import maximizeSvg from './svg/maximize-16.svg?raw';
import restoreSvg from './svg/restore-16.svg?raw';
import clockSvg from './svg/clock-16.svg?raw';
import plusSvg from './svg/plus-16.svg?raw';
import editSvg from './svg/edit-16.svg?raw';
import deleteSvg from './svg/delete-16.svg?raw';
import handSvg from './svg/hand-16.svg?raw';
import codeSvg from './svg/code-16.svg?raw';
import planSvg from './svg/plan-16.svg?raw';
import zapSvg from './svg/zap-16.svg?raw';
import gearSvg from './svg/gear-16.svg?raw';
import checkSvg from './svg/check-16.svg?raw';
import attachSvg from './svg/attach-16.svg?raw';
import toolSvg from './svg/tool-16.svg?raw';
import sendSvg from './svg/send-16.svg?raw';
import stopSvg from './svg/stop-16.svg?raw';
import micSvg from './svg/mic-16.svg?raw';

/**
 * Convert SVG string to Lit template using unsafeHTML
 */
function toLitTemplate(svgString: string) {
    return html`${unsafeHTML(svgString)}`;
}

// Icon templates
export const minimizeIcon = toLitTemplate(minimizeSvg);
export const maximizeIcon = toLitTemplate(maximizeSvg);
export const restoreIcon = toLitTemplate(restoreSvg);
export const clockIcon = toLitTemplate(clockSvg);
export const plusIcon = toLitTemplate(plusSvg);
export const editIcon = toLitTemplate(editSvg);
export const deleteIcon = toLitTemplate(deleteSvg);
export const handIcon = toLitTemplate(handSvg);
export const codeIcon = toLitTemplate(codeSvg);
export const planIcon = toLitTemplate(planSvg);
export const zapIcon = toLitTemplate(zapSvg);
export const gearIcon = toLitTemplate(gearSvg);
export const checkIcon = toLitTemplate(checkSvg);
export const attachIcon = toLitTemplate(attachSvg);
export const toolIcon = toLitTemplate(toolSvg);
export const sendIcon = toLitTemplate(sendSvg);
export const stopIcon = toLitTemplate(stopSvg);
export const micIcon = toLitTemplate(micSvg);

/**
 * Icon name to template mapping
 */
export const icons = {
    minimize: minimizeIcon,
    maximize: maximizeIcon,
    restore: restoreIcon,
    clock: clockIcon,
    plus: plusIcon,
    edit: editIcon,
    delete: deleteIcon,
    hand: handIcon,
    code: codeIcon,
    plan: planIcon,
    zap: zapIcon,
    gear: gearIcon,
    check: checkIcon,
    attach: attachIcon,
    tool: toolIcon,
    send: sendIcon,
    stop: stopIcon,
    mic: micIcon,
} as const;

export type IconName = keyof typeof icons;

/**
 * Get icon template by name
 */
export function getIcon(name: IconName) {
    return icons[name];
}
