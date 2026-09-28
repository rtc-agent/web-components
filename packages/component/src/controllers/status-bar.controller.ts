/**
 * Status Bar Controller
 *
 * Derives status bar information from EditorAreaController.
 * Read-only: does not modify editor state, only computes display data.
 *
 * Design points:
 * - Depends on EditorAreaController to get current active tab
 * - Infers file type from file path
 * - Infers save status from isDirty
 * - Cursor position is passed through directly
 *
 * Debug HTML can directly use this Controller to drive the status bar component.
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {StatusBarInfo} from '../types/index.js';
import type {EditorAreaController} from './editor-area.controller.js';

/**
 * Infer file type label from file path
 */
function inferFileType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'md':
            return 'Markdown';
        case 'js':
            return 'JavaScript';
        case 'ts':
            return 'TypeScript';
        case 'json':
            return 'JSON';
        case 'html':
            return 'HTML';
        case 'css':
            return 'CSS';
        case 'txt':
            return 'Plain Text';
        default:
            return 'File';
    }
}

export class StatusBarController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _editorController: EditorAreaController;

    constructor(host: ReactiveControllerHost, editorController: EditorAreaController) {
        this._host = host;
        this._editorController = editorController;
        this._host.addController(this);
    }

    hostConnected() {}

    hostDisconnected() {}

    /**
     * Compute current status bar information
     *
     * Derived from EditorAreaController's activeTab.
     * Returns empty state when no active tab (saveStatus='none').
     */
    get info(): StatusBarInfo {
        const activeTab = this._editorController.activeTab;

        if (!activeTab) {
            return {
                fileType: '',
                encoding: 'UTF-8',
                cursor: {line: 1, column: 1},
                saveStatus: 'none',
            };
        }

        return {
            fileType: inferFileType(activeTab.filePath),
            encoding: 'UTF-8',
            cursor: activeTab.cursorPosition,
            saveStatus: activeTab.isDirty ? 'unsaved' : 'saved',
        };
    }
}
