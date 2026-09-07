/**
 * Status Bar Controller
 *
 * 从 EditorAreaController 派生状态栏信息。
 * 只读：不修改编辑器状态，只计算显示数据。
 *
 * 设计要点：
 * - 依赖 EditorAreaController 获取当前活动 tab
 * - 从文件路径推断文件类型
 * - 从 isDirty 推断保存状态
 * - 光标位置直接透传
 *
 * Debug HTML 可直接使用此 Controller 驱动状态栏组件。
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {StatusBarInfo} from '../types/index.js';
import type {EditorAreaController} from './editor-area.controller.js';

/**
 * 从文件路径推断文件类型标签
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
     * 计算当前状态栏信息
     *
     * 从 EditorAreaController 的 activeTab 派生。
     * 无活动 tab 时返回空状态（saveStatus='none'）。
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
