/**
 * Virtual File System operations for <rtc-agent>.
 *
 * Encapsulates all VFS-related logic (file tree loading, file open/save,
 * editor content restoration, cross-tab file change handling).
 * Extracted from rtc-agent.ts to keep the root component lean.
 */
import { msg, str } from '@lit/localize';
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
 * Files currently being saved (per-file concurrency guard).
 *
 * Prevents overlapping writes to the same file, which could complete
 * out of order and leave stale content in VFS.
 */
const _savingFiles = new Set<string>();

/**
 * Save file: write editor content to VFS.
 *
 * Sets `editedByUser: true` in metadata to protect from system overwrites.
 *
 * Race-condition safety (loop-until-stable + per-file lock):
 *
 * 1. Concurrency guard: if a save is already in-flight for this file,
 *    returns immediately. The in-flight save's loop will detect content
 *    drift and re-write.
 * 2. Snapshot comparison: captures content before each write; after write
 *    completes, re-reads current tab content. If they differ, the user
 *    typed during the write -- loop writes again with latest content.
 * 3. The lock is held throughout the entire loop, preventing out-of-order
 *    writes from concurrent save attempts (e.g. Ctrl+S during auto-save).
 * 4. Loop naturally converges: user stops typing -> content stable ->
 *    at most 1 extra iteration after drift detection.
 */
export async function handleEditorSave(
    filePath: string,
    deps: VfsDeps,
): Promise<void> {
    // -- Concurrency guard --
    if (_savingFiles.has(filePath)) {
        return;  // In-flight save will handle drift via its loop.
    }

    _savingFiles.add(filePath);
    let writeAttempted = false;
    let lastWriteOk = false;

    try {
        // Loop until content is stable (no drift detected after write).
        // Typically 1 iteration; 2 if user typed during the save; rarely more.
        while (true) {
            const tab = deps.editorArea.tabs.find((t) => t.filePath === filePath);
            if (!tab) break;  // Tab closed -- nothing to save.

            writeAttempted = true;
            const contentAtSave = tab.content;

            try {
                await virtualFS.write(filePath, contentAtSave, "overwrite", {
                    editedByUser: true,
                });
                lastWriteOk = true;
            } catch (err) {
                deps.logger.error("Failed to save file:", filePath, err);
                lastWriteOk = false;
                break;
            }

            // -- Post-write consistency check --
            const currentTab = deps.editorArea.tabs.find(
                (t) => t.filePath === filePath,
            );
            if (!currentTab || currentTab.content === contentAtSave) {
                break;  // Content stable -- save complete.
            }
            // Content drifted (user typed during write).
            // Continue loop -- next iteration reads fresh content.
            // No need to call updateContent: tab already has latest
            // content and isDirty=true from the input event handler.
        }

        // Settle state: one saveFile + one toast for the entire loop.
        // Only update UI state if tab still exists (user didn't close it).
        const tabStillExists = deps.editorArea.tabs.some(
            (t) => t.filePath === filePath
        );

        if (writeAttempted && lastWriteOk && tabStillExists) {
            deps.editorArea.actions.saveFile(filePath);
            deps.toast.show(msg("已保存"), "success");
        } else if (writeAttempted && !lastWriteOk) {
            deps.toast.show(msg("保存文件失败"), "error");
        }
        // else: tab was closed or never existed, do nothing
    } finally {
        _savingFiles.delete(filePath);
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
            deps.toast.show(msg(str`文件 ${filePath} 被其他标签页修改`), "info");
        }
    } else if (field === "delete") {
        // File deleted: close tab if open.
        const tab = deps.editorArea.tabs.find((t) => t.filePath === filePath);
        if (tab) {
            deps.editorArea.actions.closeFile(filePath);
            deps.toast.show(msg(str`文件 ${filePath} 已被删除`), "info");
        }
    }
}

// ── Restore Default ──

/**
 * Dependencies for handleRestoreDefault.
 */
export interface RestoreDefaultDeps {
    persistence: {
        workerBridge?: {
            core: {
                virtualFSWrite(
                    path: string,
                    content: string,
                    mode: 'overwrite' | 'append',
                    metadataOverride?: Partial<{ editedByUser: boolean }>,
                ): Promise<number>;
            };
        };
    };
    editorArea: {
        actions: {
            loadContent(path: string, content: string): void;
        };
    };
    skill: {
        actions: {
            getRegistry(): {
                generateAllDocsContent(scenarioCount?: number): Promise<{files: Array<{path: string; content: string}>; deletePaths: string[]}>;
            } | null;
        };
    };
    scenariosURL: string;
    toast: ToastActions;
    logger: Logger;
}

/**
 * Restore a file to its default (system-generated) content.
 *
 * For /AGENT.md and /functions/*.md: regenerates from the current registry.
 * For /scenarios/*.md: reloads from the scenariosURL (if set).
 *
 * After restore, sets `editedByUser: false` to allow future system updates.
 */
export async function handleRestoreDefault(
    filePath: string,
    deps: RestoreDefaultDeps,
): Promise<{success: boolean; error?: string}> {
    const bridge = deps.persistence.workerBridge;
    if (!bridge) {
        return {success: false, error: 'Persistence not connected'};
    }

    try {
        let defaultContent: string | null = null;

        // Determine default content based on file path
        if (filePath === '/AGENT.md' || filePath.startsWith('/functions/')) {
            // Generate from registry
            const registry = deps.skill.actions.getRegistry();
            if (!registry) {
                return {success: false, error: 'Registry not available'};
            }
            const {files} = await registry.generateAllDocsContent(0);
            const file = files.find(f => f.path === filePath);
            if (file) {
                defaultContent = file.content;
            }
        } else if (filePath.startsWith('/scenarios/')) {
            // Reload from scenariosURL
            if (!deps.scenariosURL) {
                return {success: false, error: 'Scenarios URL not configured'};
            }
            // Import scenario-loader dynamically to avoid circular dependency
            const {loadScenariosContent} = await import('../../../core/scenario-loader.js');
            const {files} = await loadScenariosContent(deps.scenariosURL);
            const file = files.find(f => f.path === filePath);
            if (file) {
                defaultContent = file.content;
            }
        }

        if (defaultContent === null) {
            return {success: false, error: 'Cannot determine default content for this file'};
        }

        // Write to VFS with editedByUser: false
        await bridge.core.virtualFSWrite(filePath, defaultContent, 'overwrite', {
            editedByUser: false,
        });

        // Update editor content (silent, no dirty flag)
        deps.editorArea.actions.loadContent(filePath, defaultContent);

        deps.logger.info('Restored file to default:', filePath);
        return {success: true};
    } catch (err) {
        deps.logger.error('Failed to restore default:', filePath, err);
        return {success: false, error: err instanceof Error ? err.message : String(err)};
    }
}
