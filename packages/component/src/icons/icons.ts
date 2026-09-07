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
import checklistSvg from './svg/checklist-16.svg?raw';

// File explorer icons (Phase 1)
// Note: saveIcon uses octicon 'download' — octicons has no 'save' glyph.
// Note: filesIcon and folderClosedIcon share the same 'file-directory' SVG source.
import fileDirectorySvg from './svg/file-directory-16.svg?raw';
import commentDiscussionSvg from './svg/comment-discussion-16.svg?raw';
import fileDirectoryOpenFillSvg from './svg/file-directory-open-fill-16.svg?raw';
import markdownSvg from './svg/markdown-16.svg?raw';
import fileCodeSvg from './svg/file-code-16.svg?raw';
import fileSvg from './svg/file-16.svg?raw';
import syncSvg from './svg/sync-16.svg?raw';
import downloadSvg from './svg/download-16.svg?raw';
import undoSvg from './svg/undo-16.svg?raw';
import redoSvg from './svg/redo-16.svg?raw';
import xSvg from './svg/x-16.svg?raw';

// Editor toolbar icons (Phase 2.5)
// bold / italic: Formatting actions.
// link: Insert hyperlink.
// eye: Preview mode.
// columns: Split-screen view.
import boldSvg from './svg/text-bold-16.svg?raw';
import italicSvg from './svg/text-italic-16.svg?raw';
import linkSvg from './svg/link-16.svg?raw';
import eyeSvg from './svg/eye-16.svg?raw';
import columnsSvg from './svg/columns-16.svg?raw';

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
export const checklistIcon = toLitTemplate(checklistSvg);

// File explorer icons (Phase 1)
// filesIcon: Activity Bar "Explorer" activity.
export const filesIcon = toLitTemplate(fileDirectorySvg);
// chatIcon: Activity Bar "Chat" activity.
export const chatIcon = toLitTemplate(commentDiscussionSvg);
// folderClosedIcon: File tree collapsed folder. Same SVG as filesIcon.
export const folderClosedIcon = toLitTemplate(fileDirectorySvg);
// folderOpenIcon: File tree expanded folder.
export const folderOpenIcon = toLitTemplate(fileDirectoryOpenFillSvg);
// fileMarkdownIcon: .md file in tree.
export const fileMarkdownIcon = toLitTemplate(markdownSvg);
// fileScriptIcon: .js / .ts file in tree.
export const fileScriptIcon = toLitTemplate(fileCodeSvg);
// fileDefaultIcon: Other file types in tree.
export const fileDefaultIcon = toLitTemplate(fileSvg);
// refreshIcon: Refresh action (sidebar header, etc.).
export const refreshIcon = toLitTemplate(syncSvg);
// saveIcon: Save action. Octicons has no 'save' glyph — uses 'download' instead.
export const saveIcon = toLitTemplate(downloadSvg);
// undoIcon / redoIcon: History navigation.
export const undoIcon = toLitTemplate(undoSvg);
export const redoIcon = toLitTemplate(redoSvg);
// closeIcon: Close tab / dismiss.
export const closeIcon = toLitTemplate(xSvg);

// Editor toolbar icons (Phase 2.5)
// boldIcon: Bold formatting action.
export const boldIcon = toLitTemplate(boldSvg);
// italicIcon: Italic formatting action.
export const italicIcon = toLitTemplate(italicSvg);
// linkIcon: Insert hyperlink action.
export const linkIcon = toLitTemplate(linkSvg);
// eyeIcon: Preview mode toggle.
export const eyeIcon = toLitTemplate(eyeSvg);
// columnsIcon: Split-screen view toggle.
export const columnsIcon = toLitTemplate(columnsSvg);

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
    checklist: checklistIcon,
    // File explorer icons (Phase 1)
    files: filesIcon,
    chat: chatIcon,
    folderClosed: folderClosedIcon,
    folderOpen: folderOpenIcon,
    fileMarkdown: fileMarkdownIcon,
    fileScript: fileScriptIcon,
    fileDefault: fileDefaultIcon,
    refresh: refreshIcon,
    save: saveIcon,
    undo: undoIcon,
    redo: redoIcon,
    close: closeIcon,
    // Editor toolbar icons (Phase 2.5)
    bold: boldIcon,
    italic: italicIcon,
    link: linkIcon,
    eye: eyeIcon,
    columns: columnsIcon,
} as const;

export type IconName = keyof typeof icons;

/**
 * Get icon template by name
 */
export function getIcon(name: IconName) {
    return icons[name];
}
