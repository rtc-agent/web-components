/**
 * Function Debugger Component
 *
 * Main debugging panel that combines function info, parameter editor,
 * execute button, console output, and execution history.
 *
 * @element rtc-function-debugger
 */
import {LitElement, html, nothing, type TemplateResult} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-function-debugger.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {FunctionDebugContext, type FunctionDebugContextValue} from '../../contexts/function-debug.js';
import {chevronDownIcon, chevronRightIcon} from '../../icons/index.js';
import {createLogger} from '@rtc-agent/client';
import {schemaToTypeString} from '../../core/markdown-generator.js';
import type {OpenAPISchema} from '../../types/skill.js';

import '../function-params/rtc-function-params.js';
import '../function-console/rtc-function-console.js';
import '../function-history/rtc-function-history.js';

const log = createLogger('FunctionDebugger');

@localized()
@customElement('rtc-function-debugger')
export class RtcFunctionDebugger extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /** Theme (inherited from parent) */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    @consume({context: FunctionDebugContext, subscribe: true})
    @property({attribute: false})
    private _debugCtx: FunctionDebugContextValue | undefined;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /** Whether function info section is collapsed */
    @state()
    private _infoCollapsed = false;

    private async _handleExecute() {
        if (this._debugCtx) {
            await this._debugCtx.actions.execute();
        }
    }

    /**
     * Recursively render parameter rows for the documentation table.
     *
     * Handles primitive, array, and object types with nested expansion.
     * Mirrors the logic in markdown-generator's schemaToTableRows.
     */
    private _renderParamRows(schema: OpenAPISchema, name: string, required: boolean, description?: string, depth: number = 0): TemplateResult[] {
        const rows: TemplateResult[] = [];
        const indent = depth > 0 ? '└─ ' : '';
        const displayName = `${indent}${name}`;
        const desc = description || schema.description || '';
        const typeStr = schemaToTypeString(schema);

        // Primitive type
        if (schema.type && schema.type !== 'object' && schema.type !== 'array') {
            rows.push(html`
                <tr>
                    <td class="param-name">${displayName}</td>
                    <td class="param-type">${typeStr}</td>
                    <td class="param-required">${required ? msg('是') : msg('否')}</td>
                    <td class="param-desc">${desc}</td>
                </tr>
            `);
            return rows;
        }

        // Array type
        if (schema.type === 'array' && schema.items) {
            rows.push(html`
                <tr>
                    <td class="param-name">${displayName}</td>
                    <td class="param-type">${typeStr}</td>
                    <td class="param-required">${required ? msg('是') : msg('否')}</td>
                    <td class="param-desc">${desc}</td>
                </tr>
            `);
            // Expand items if object
            if (schema.items.type === 'object' && schema.items.properties) {
                const requiredFields = (schema.items.required || []) as string[];
                for (const [propName, propSchema] of Object.entries(schema.items.properties)) {
                    const propRequired = requiredFields.includes(propName);
                    rows.push(...this._renderParamRows(propSchema, propName, propRequired, propSchema.description, depth + 1));
                }
            }
            return rows;
        }

        // Object type
        if (schema.type === 'object' && schema.properties) {
            rows.push(html`
                <tr>
                    <td class="param-name">${displayName}</td>
                    <td class="param-type">object</td>
                    <td class="param-required">${required ? msg('是') : msg('否')}</td>
                    <td class="param-desc">${desc}</td>
                </tr>
            `);
            const requiredFields = (schema.required || []) as string[];
            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                const propRequired = requiredFields.includes(propName);
                rows.push(...this._renderParamRows(propSchema, propName, propRequired, propSchema.description, depth + 1));
            }
            return rows;
        }

        // Fallback
        rows.push(html`
            <tr>
                <td class="param-name">${displayName}</td>
                <td class="param-type">${typeStr}</td>
                <td class="param-required">${required ? msg('是') : msg('否')}</td>
                <td class="param-desc">${desc}</td>
            </tr>
        `);
        return rows;
    }

    private _renderFunctionInfo() {
        const fn = this._debugCtx?.state.selectedFunction;
        if (!fn) return nothing;

        return html`
            <div class="function-info-section">
                <div class="info-header" @click=${() => this._infoCollapsed = !this._infoCollapsed}>
                    <span class="info-chevron">
                        ${this._infoCollapsed ? chevronRightIcon : chevronDownIcon}
                    </span>
                    <span class="info-title">${msg('函数信息')}</span>
                </div>
                ${!this._infoCollapsed ? html`
                    <div class="info-body">
                        <div class="info-name">${fn.name}</div>
                        ${fn.description ? html`
                            <div class="info-description">${fn.description}</div>
                        ` : nothing}
                        ${fn.parameters && fn.parameters.length > 0 ? html`
                            <div class="info-params-doc">
                                <div class="params-doc-title">${msg('参数文档')}</div>
                                <table class="params-doc-table">
                                    <thead>
                                        <tr>
                                            <th>${msg('名称')}</th>
                                            <th>${msg('类型')}</th>
                                            <th>${msg('必填')}</th>
                                            <th>${msg('描述')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${fn.parameters!.flatMap(param =>
                                            this._renderParamRows(
                                                param.schema,
                                                param.name,
                                                param.required || false,
                                                param.description || param.schema?.description,
                                            )
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ` : nothing}
                    </div>
                ` : nothing}
            </div>
        `;
    }

    private _renderEmptyState() {
        return html`
            <div class="empty-state">
                <span class="empty-state-text">${msg('从左侧选择一个函数开始调试')}</span>
            </div>
        `;
    }

    private _renderContent() {
        const fn = this._debugCtx?.state.selectedFunction;
        const status = this._debugCtx?.state.executionStatus ?? 'idle';

        if (!fn) return this._renderEmptyState();

        return html`
            <div class="debugger-content">
                <!-- Function Info (collapsible) -->
                ${this._renderFunctionInfo()}

                <!-- Parameters -->
                <div class="params-section">
                    <rtc-function-params theme=${this.theme}></rtc-function-params>
                </div>

                <!-- Action Bar -->
                <div class="action-bar">
                    <button
                        class="run-btn ${status === 'running' ? 'running' : ''}"
                        ?disabled=${status === 'running'}
                        @click=${this._handleExecute}
                    >
                        ${status === 'running'
                            ? html`⟳ ${msg('执行中...')}`
                            : html`▶ ${msg('运行')}`}
                    </button>
                    ${status === 'success' ? html`
                        <span class="status-indicator success">✓ ${msg('执行成功')}</span>
                    ` : nothing}
                    ${status === 'error' ? html`
                        <span class="status-indicator error">✗ ${msg('执行失败')}</span>
                    ` : nothing}
                </div>

                <!-- Console -->
                <div class="console-section">
                    <rtc-function-console theme=${this.theme}></rtc-function-console>
                </div>

                <!-- History -->
                <div class="history-section">
                    <rtc-function-history theme=${this.theme}></rtc-function-history>
                </div>
            </div>
        `;
    }

    render() {
        void this._localeCtx.locale;
        return this._renderContent();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-function-debugger': RtcFunctionDebugger;
    }
}
