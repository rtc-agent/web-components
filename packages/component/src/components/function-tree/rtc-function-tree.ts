/**
 * Function Tree Component
 *
 * Displays registered functions organized in a tree structure.
 * Groups functions by their dot notation (e.g., "user.register" → group "user", function "register").
 *
 * Features:
 * - Tree view with expandable/collapsible groups
 * - Keyboard navigation (↑/↓/←/→/Enter/Home/End)
 * - Function selection with visual highlight
 * - Displays function name and description
 * - Persists expand state and active function to localStorage
 *
 * @element rtc-function-tree
 * @fires function-select - User clicks a function (detail: { functionName })
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-function-tree.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {FunctionsContext, type FunctionsContextValue} from '../../contexts/functions.js';
import {FunctionDebugContext, type FunctionDebugContextValue} from '../../contexts/function-debug.js';
import type {FunctionDef} from '../../types/skill.js';
import {chevronRightIcon, chevronDownIcon} from '../../icons/index.js';
import {createLogger} from '@rtc-agent/client';
import {STORAGE_KEYS} from '../../config/auth.js';

const log = createLogger('FunctionTree');

/**
 * Tree node types
 */
type TreeNodeType = 'group' | 'function';

interface TreeNode {
    id: string;
    type: TreeNodeType;
    name: string;
    description?: string;
    children?: TreeNode[];
    functionDef?: FunctionDef;
}

/**
 * Build tree structure from flat function list
 *
 * Algorithm:
 * - Split function name by '.' to get path segments
 * - First segment becomes group name
 * - Remaining segments become nested path within group
 * - Functions without '.' are placed at root level
 */
function buildTreeFromFunctions(functions: FunctionDef[]): TreeNode[] {
    const rootNodes = new Map<string, TreeNode>();
    const groupNodes = new Map<string, TreeNode>();

    // First pass: create group nodes
    for (const fn of functions) {
        const parts = fn.name.split('.');
        if (parts.length > 1) {
            const groupName = parts[0];
            if (!groupNodes.has(groupName)) {
                groupNodes.set(groupName, {
                    id: `group:${groupName}`,
                    type: 'group',
                    name: groupName,
                    children: [],
                });
            }
        }
    }

    // Add groups to root
    for (const group of groupNodes.values()) {
        rootNodes.set(group.id, group);
    }

    // Second pass: add functions to their groups or root
    for (const fn of functions) {
        const parts = fn.name.split('.');

        if (parts.length > 1) {
            // Function belongs to a group
            const groupName = parts[0];
            const group = groupNodes.get(groupName);
            if (group && group.children) {
                // Use the function name without group prefix for display
                const displayName = parts.slice(1).join('.');
                group.children.push({
                    id: `fn:${fn.name}`,
                    type: 'function',
                    name: displayName,
                    description: fn.description,
                    functionDef: fn,
                });
            }
        } else {
            // Function at root level
            rootNodes.set(`fn:${fn.name}`, {
                id: `fn:${fn.name}`,
                type: 'function',
                name: fn.name,
                description: fn.description,
                functionDef: fn,
            });
        }
    }

    // Sort: groups first, then functions, alphabetically within each category
    const sortedRoot = Array.from(rootNodes.values()).sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'group' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    // Sort children within groups
    for (const node of sortedRoot) {
        if (node.type === 'group' && node.children) {
            node.children.sort((a, b) => a.name.localeCompare(b.name));
        }
    }

    return sortedRoot;
}

@localized()
@customElement('rtc-function-tree')
export class RtcFunctionTree extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Properties ── */

    /** Theme (inherited from parent) */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── i18n ── */

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Context ── */

    @consume({context: FunctionsContext, subscribe: true})
    @property({attribute: false})
    private _functionsCtx: FunctionsContextValue | undefined;

    @consume({context: FunctionDebugContext, subscribe: true})
    @property({attribute: false})
    private _debugCtx: FunctionDebugContextValue | undefined;

    /* ── State ── */

    /** Tree nodes (computed from functions list) */
    @state()
    private _treeNodes: TreeNode[] = [];

    /** Currently focused node ID (for keyboard navigation) */
    @state()
    private _focusedNodeId: string | null = null;

    /** Set of expanded node IDs */
    @state()
    private _expandedNodes = new Set<string>();

    /** Whether active function has been loaded from localStorage (prevents recursion) */
    private _activeLoaded = false;

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();
        this._loadExpandedState();
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);

        // Rebuild tree when functions change
        if (changed.has('_functionsCtx')) {
            this._rebuildTree();
        }
    }

    /* ── LocalStorage Persistence ── */

    private _loadExpandedState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.functionTreeExpanded);
            if (raw) {
                const expanded = JSON.parse(raw);
                if (Array.isArray(expanded)) {
                    this._expandedNodes = new Set(expanded);
                }
            }
        } catch (err) {
            log.debug('Failed to load expanded state:', err);
        }
    }

    private _saveExpandedState() {
        try {
            localStorage.setItem(
                STORAGE_KEYS.functionTreeExpanded,
                JSON.stringify(Array.from(this._expandedNodes))
            );
        } catch (err) {
            log.debug('Failed to save expanded state:', err);
        }
    }

    private _loadActiveFunction() {
        try {
            const functionName = localStorage.getItem(STORAGE_KEYS.functionTreeActive);
            if (functionName && this._functionsCtx?.state.functions) {
                const fn = this._functionsCtx.state.functions.find(f => f.name === functionName);
                if (fn && this._debugCtx) {
                    this._debugCtx.actions.selectFunction(fn);
                    this._focusedNodeId = `fn:${fn.name}`;
                }
            }
        } catch (err) {
            log.debug('Failed to load active function:', err);
        }
    }

    private _saveActiveFunction(functionName: string) {
        try {
            localStorage.setItem(STORAGE_KEYS.functionTreeActive, functionName);
        } catch (err) {
            log.debug('Failed to save active function:', err);
        }
    }

    /* ── Tree Building ── */

    private _rebuildTree() {
        if (!this._functionsCtx?.state.functions) {
            this._treeNodes = [];
            return;
        }

        this._treeNodes = buildTreeFromFunctions(this._functionsCtx.state.functions);

        // Merge persisted expanded state with default group expansion
        const newExpanded = new Set(this._expandedNodes);
        for (const node of this._treeNodes) {
            if (node.type === 'group') {
                newExpanded.add(node.id);
            }
        }
        this._expandedNodes = newExpanded;

        // Set initial focus to first node
        if (this._treeNodes.length > 0 && !this._focusedNodeId) {
            this._focusedNodeId = this._treeNodes[0].id;
        }

        // Load active function once after tree is built (guard against recursion)
        if (!this._activeLoaded) {
            this._activeLoaded = true;
            this._loadActiveFunction();
        }
    }

    /* ── Event Handlers ── */

    private _handleNodeClick(node: TreeNode) {
        if (node.type === 'group') {
            this._toggleNode(node.id);
        } else if (node.type === 'function' && node.functionDef) {
            this._selectFunction(node.functionDef);
        }
    }

    private _toggleNode(nodeId: string) {
        const newExpanded = new Set(this._expandedNodes);
        if (newExpanded.has(nodeId)) {
            newExpanded.delete(nodeId);
        } else {
            newExpanded.add(nodeId);
        }
        this._expandedNodes = newExpanded;
        this._saveExpandedState();
    }

    private _selectFunction(fn: FunctionDef) {
        this._focusedNodeId = `fn:${fn.name}`;

        if (this._debugCtx) {
            this._debugCtx.actions.selectFunction(fn);
        }

        this._saveActiveFunction(fn.name);

        this.dispatchEvent(
            new CustomEvent('function-select', {
                bubbles: true,
                composed: true,
                detail: {functionName: fn.name},
            })
        );
    }

    /* ── Keyboard Navigation ── */

    private _getVisibleNodes(): TreeNode[] {
        const result: TreeNode[] = [];

        const walk = (nodes: TreeNode[]) => {
            for (const node of nodes) {
                result.push(node);
                if (node.type === 'group' && node.children && this._expandedNodes.has(node.id)) {
                    walk(node.children);
                }
            }
        };

        walk(this._treeNodes);
        return result;
    }

    private _handleKeydown(e: KeyboardEvent) {
        const visibleNodes = this._getVisibleNodes();
        if (visibleNodes.length === 0) return;

        const currentIndex = this._focusedNodeId
            ? visibleNodes.findIndex(n => n.id === this._focusedNodeId)
            : -1;

        let handled = true;

        switch (e.key) {
            case 'ArrowDown': {
                const next = Math.min(currentIndex + 1, visibleNodes.length - 1);
                this._focusedNodeId = visibleNodes[next].id;
                break;
            }
            case 'ArrowUp': {
                const prev = Math.max(currentIndex - 1, 0);
                this._focusedNodeId = visibleNodes[prev].id;
                break;
            }
            case 'ArrowRight': {
                if (currentIndex >= 0) {
                    const node = visibleNodes[currentIndex];
                    if (node.type === 'group' && !this._expandedNodes.has(node.id)) {
                        this._toggleNode(node.id);
                    }
                }
                break;
            }
            case 'ArrowLeft': {
                if (currentIndex >= 0) {
                    const node = visibleNodes[currentIndex];
                    if (node.type === 'group' && this._expandedNodes.has(node.id)) {
                        this._toggleNode(node.id);
                    }
                }
                break;
            }
            case 'Enter':
            case ' ': {
                if (currentIndex >= 0) {
                    const node = visibleNodes[currentIndex];
                    this._handleNodeClick(node);
                }
                break;
            }
            case 'Home': {
                this._focusedNodeId = visibleNodes[0].id;
                break;
            }
            case 'End': {
                this._focusedNodeId = visibleNodes[visibleNodes.length - 1].id;
                break;
            }
            default:
                handled = false;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /* ── Render ── */

    private _renderNode(node: TreeNode, depth: number = 0): unknown {
        const isExpanded = this._expandedNodes.has(node.id);
        const isFocused = this._focusedNodeId === node.id;
        const isSelected = this._debugCtx?.state.selectedFunction?.name === node.functionDef?.name;

        const indent = depth * 16;

        if (node.type === 'group') {
            return html`
                <div
                    class="tree-node group-node ${isFocused ? 'focused' : ''}"
                    style="padding-left: ${indent}px"
                    role="treeitem"
                    aria-expanded=${isExpanded}
                    tabindex=${isFocused ? '0' : '-1'}
                    @click=${() => this._handleNodeClick(node)}
                >
                    <span class="chevron">
                        ${isExpanded ? chevronDownIcon : chevronRightIcon}
                    </span>
                    <span class="node-name">${node.name}</span>
                </div>
                ${isExpanded && node.children
                    ? node.children.map(child => this._renderNode(child, depth + 1))
                    : nothing}
            `;
        } else {
            return html`
                <div
                    class="tree-node function-node ${isFocused ? 'focused' : ''} ${isSelected ? 'selected' : ''}"
                    style="padding-left: ${indent}px"
                    role="treeitem"
                    tabindex=${isFocused ? '0' : '-1'}
                    @click=${() => this._handleNodeClick(node)}
                >
                    <span class="node-name">${node.name}</span>
                    ${node.description ? html`<span class="node-description">${node.description}</span>` : nothing}
                </div>
            `;
        }
    }

    private _renderEmptyState() {
        return html`
            <div class="empty-state">
                <span class="empty-state-text">${msg('暂无已注册的函数')}</span>
            </div>
        `;
    }

    render() {
        void this._localeCtx.locale;

        if (this._treeNodes.length === 0) {
            return html`
                <div class="tree-header">
                    <span class="tree-title">${msg('函数')}</span>
                </div>
                ${this._renderEmptyState()}
            `;
        }

        return html`
            <div class="tree-header">
                <span class="tree-title">${msg('函数')}</span>
            </div>
            <div
                class="tree-container"
                role="tree"
                aria-label=${msg('函数树')}
                @keydown=${this._handleKeydown}
            >
                ${this._treeNodes.map(node => this._renderNode(node, 0))}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-function-tree': RtcFunctionTree;
    }

    interface HTMLElementEventMap {
        'function-select': CustomEvent<{functionName: string}>;
    }
}
