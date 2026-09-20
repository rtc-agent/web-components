/**
 * Virtual File System operations for <rtc-agent>.
 *
 * Encapsulates all VFS-related logic (file tree loading, file open/save,
 * editor content restoration, cross-tab file change handling).
 * Extracted from rtc-agent.ts to keep the root component lean.
 */
import { msg } from '@lit/localize';
import { virtualFS } from '@rtc-agent/persistence';
import type { Logger } from '@rtc-agent/client';
import type { FileNode } from '../../../types/index.js';
import type { ToastActions } from '../../../controllers/toast.controller.js';

// ── Dependency interfaces ──

export interface VfsDeps {
    persistenceIsConnected: boolean;
    fileExplorer: {
        actions: {
            setRoot(root: FileNode): void;
            setLoading(path: string, loading: boolean): void;
            updateChildren(path: string, children: FileNode[]): void;
            selectNode(path: string): void;
        };
        value: {
            isExpanded(path: string): boolean;
        };
    };
    editorArea: {
        tabs: ReadonlyArray<{
            filePath: string;
            content: string;
            isDirty: boolean;
        }>;
        activeFilePath: string | null;
        actions: {
            openFile(path: string, content?: string, viewMode?: string): void;
            closeFile(path: string): void;
            loadContent(path: string, content: string): void;
            saveFile(path: string): void;
        };
    };
    toast: ToastActions;
    settingsDefaultViewMode: string;
    logger: Logger;
}

// ── File Tree Loading ──

/**
 * Load file tree from virtualFS (root directory, first level only).
 *
 * Phase 4: only loads the root's immediate children;
 * subdirectories are lazy-loaded on demand via {@link loadFolderChildren}.
 *
 * @returns `true` if the tree was loaded successfully.
 */
export async function loadFileTree(deps: VfsDeps): Promise<boolean> {
    if (!deps.persistenceIsConnected) return false;

    try {
        const root = await buildFileNodeShallow("/");
        deps.fileExplorer.actions.setRoot(root);
        return true;
    } catch (err) {
        deps.logger.error("Failed to load file tree:", err);
        return false;
    }
}

/**
 * Shallow-build a FileNode: only load the immediate children of a directory.
 *
 * Subdirectory children are left as `undefined` (not loaded);
 * they are loaded on demand by {@link loadFolderChildren} when the user expands them.
 */
export async function buildFileNodeShallow(path: string): Promise<FileNode> {
    const name = path === "/" ? "/" : path.split("/").pop()!;
    const isRoot = path === "/";

    // If the path exists in VFS -> file.
    if (!isRoot && (await virtualFS.exists(path))) {
        return { path, name, type: "file" };
    }

    // Otherwise treat as directory; ls to get immediate children.
    const children: FileNode[] = [];
    try {
        const entries = await virtualFS.ls(path);
        for (const entry of entries) {
            const childPath = isRoot ? `/${entry}` : `${path}/${entry}`;
            if (await virtualFS.exists(childPath)) {
                children.push({ path: childPath, name: entry, type: "file" });
            } else {
                // Directory: children left empty (not loaded), lazy-loaded on expand.
                children.push({ path: childPath, name: entry, type: "folder" });
            }
        }
    } catch {
        // ls failed -> empty directory.
    }

    return { path, name, type: "folder", children };
}

/**
 * Lazy-load children of a directory.
 *
 * Triggered by folder-toggle event (on first expand).
 * Updates the file tree via fileExplorer.actions.updateChildren after loading.
 */
export async function loadFolderChildren(
    path: string,
    deps: VfsDeps,
): Promise<void> {
    if (!deps.persistenceIsConnected) return;

    deps.logger.debug("loadFolderChildren called for:", path);
    deps.fileExplorer.actions.setLoading(path, true);
    try {
        const entries = await virtualFS.ls(path);
        const children: FileNode[] = [];
        for (const entry of entries) {
            const childPath = path === "/" ? `/${entry}` : `${path}/${entry}`;
            if (await virtualFS.exists(childPath)) {
                children.push({ path: childPath, name: entry, type: "file" });
            } else {
                children.push({ path: childPath, name: entry, type: "folder" });
            }
        }
        deps.fileExplorer.actions.updateChildren(path, children);
    } catch (err) {
        deps.logger.error("Failed to load folder children:", path, err);
    } finally {
        deps.fileExplorer.actions.setLoading(path, false);
    }
}

// ── File Open / Save ──

/**
 * Open a file: read content from VFS and open in editor.
 */
export async function handleFileOpen(
    filePath: string,
    deps: VfsDeps,
): Promise<void> {
    try {
        const content = await virtualFS.read(filePath);
        deps.editorArea.actions.openFile(
            filePath,
            content,
            deps.settingsDefaultViewMode,
        );
        deps.fileExplorer.actions.selectNode(filePath);
    } catch (err) {
        deps.logger.error("Failed to open file:", filePath, err);
        deps.toast.show(msg("打开文件失败"), "error");
    }
}

/**
 * Restore Editor Area content for open files after page refresh.
 *
 * Tab metadata (filePath, viewMode, cursorPosition, activeFilePath) was already
 * restored from localStorage in EditorAreaController constructor, but content is empty.
 * This function iterates all restored tabs after VFS is ready, reads content from VFS,
 * and fills it in. Tabs that fail to read (file no longer exists) are auto-closed.
 */
export async function restoreEditorAreaContent(
    fileTreeLoaded: boolean,
    deps: VfsDeps,
): Promise<void> {
    const tabs = [...deps.editorArea.tabs];
    if (tabs.length === 0) return;

    const activeFilePath = deps.editorArea.activeFilePath;
    deps.logger.debug("Restoring editor area content for", tabs.length, "tabs");

    for (const tab of tabs) {
        try {
            const content = await virtualFS.read(tab.filePath);
            deps.editorArea.actions.loadContent(tab.filePath, content);
        } catch {
            // File no longer exists in VFS (e.g. deleted by another client), close the tab.
            deps.logger.warn(
                "Restored tab file not found in VFS, closing:",
                tab.filePath,
            );
            deps.editorArea.actions.closeFile(tab.filePath);
        }
    }

    // If file tree is loaded, select the currently active file.
    if (activeFilePath && fileTreeLoaded) {
        deps.fileExplorer.actions.selectNode(activeFilePath);
    }
}

/**
 * Save file: write editor content to VFS.
 */
export async function handleEditorSave(
    filePath: string,
    deps: VfsDeps,
): Promise<void> {
    const tab = deps.editorArea.tabs.find((t) => t.filePath === filePath);
    if (!tab) return;

    try {
        await virtualFS.write(filePath, tab.content, "overwrite");
        deps.editorArea.actions.saveFile(filePath);
        deps.toast.show(msg("已保存"), "success");
    } catch (err) {
        deps.logger.error("Failed to save file:", filePath, err);
        deps.toast.show(msg("保存文件失败"), "error");
    }
}

// ── Cross-tab File Change Handling ──

/**
 * Handle file change events from other tabs (via UIUpdateBus).
 *
 * - write/create: refresh parent dir in file tree; if file is open and unmodified, reload content.
 * - delete: refresh parent dir in file tree; if file is open, close the tab.
 * - batch: full refresh of file tree.
 *
 * @param filePath - The affected file path.
 * @param field - The changed field ('write', 'create', 'delete', 'batch').
 * @param fileTreeLoaded - Whether the file tree has been loaded at least once.
 * @param deps - Shared dependencies.
 * @param loadTree - Callback to reload the entire file tree.
 * @param loadChildren - Callback to reload a directory's children.
 */
export async function handleFileChange(
    filePath: string,
    field: string,
    fileTreeLoaded: boolean,
    deps: VfsDeps,
    loadTree: () => Promise<void>,
    loadChildren: (path: string) => Promise<void>,
): Promise<void> {
    if (field === "batch") {
        if (fileTreeLoaded) {
            void loadTree();
        }
        return;
    }

    // Derive parent directory path.
    const lastSlash = filePath.lastIndexOf("/");
    const parentPath = lastSlash <= 0 ? "/" : filePath.substring(0, lastSlash);

    // Refresh parent directory's children in the file tree.
    if (fileTreeLoaded) {
        if (parentPath === "/") {
            void loadTree();
        } else {
            void loadChildren(parentPath);
        }
    }

    if (field === "write" || field === "create") {
        // If the file is open and unmodified, silently reload content.
        const tab = deps.editorArea.tabs.find((t) => t.filePath === filePath);
        if (tab && !tab.isDirty) {
            try {
                const content = await virtualFS.read(filePath);
                deps.editorArea.actions.openFile(filePath, content);
            } catch {
                // Read failed — keep current content.
            }
        } else if (tab?.isDirty) {
            deps.toast.show(`文件 ${filePath} 被其他标签页修改`, "info");
        }
    } else if (field === "delete") {
        // File deleted: close tab if open.
        const tab = deps.editorArea.tabs.find((t) => t.filePath === filePath);
        if (tab) {
            deps.editorArea.actions.closeFile(filePath);
            deps.toast.show(`文件 ${filePath} 已被删除`, "info");
        }
    }
}
