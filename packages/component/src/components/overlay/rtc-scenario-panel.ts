/**
 * RTC Scenario Panel Component
 *
 * Floating panel showing available scenarios for selection.
 * Supports multi-select; selected scenarios are inserted as #tags in input.
 *
 * @element rtc-scenario-panel
 * @fires rtc-scenario-selected - User selected/toggled a scenario (detail: { scenario })
 * @fires rtc-scenario-panel-close - User pressed Escape or clicked outside
 * @csspart list - The scenario list container
 */
import {LitElement, html} from 'lit';
import {customElement, state, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {localized, msg} from '@lit/localize';
import {styles} from './rtc-scenario-panel.styles.js';
import {virtualFS, type FileSystemEntry} from '@rtc-agent/persistence';
import type {ScenarioRef} from '../../types/index.js';

/** Scenario item from VirtualFS (mapped from FileSystemEntry) */
interface ScenarioItem {
    path: string;
    name: string;
    description?: string;
    tags?: string[];
}

@localized()
@customElement('rtc-scenario-panel')
export class RtcScenarioPanel extends LitElement {
    static styles = styles;

    @state()
    private _scenarios: ScenarioItem[] = [];

    @state()
    private _selectedPaths: Set<string> = new Set();

    /** 外部传入的已选中路径列表，用于初始化选中状态 */
    @property({type: Array})
    initialSelectedPaths: string[] = [];

    @state()
    private _loading = true;

    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('keydown', this._onKeydown);
        void this._loadScenarios();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('keydown', this._onKeydown);
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);
        if (changed.has('initialSelectedPaths')) {
            this._selectedPaths = new Set(this.initialSelectedPaths);
        }
    }

    private _onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            this.dispatchEvent(
                new CustomEvent('rtc-scenario-panel-close', {
                    bubbles: true,
                    composed: true,
                })
            );
        }
    };

    private async _loadScenarios() {
        try {
            const entries: FileSystemEntry[] = await virtualFS.queryByType('scenario');
            this._scenarios = entries.map(entry => ({
                path: entry.path,
                name: entry.metadata?.name ?? entry.path.split('/').pop() ?? '',
                description: entry.metadata?.description || undefined,
                tags: entry.metadata?.tags,
            }));
        } catch (err) {
            console.warn('[RtcScenarioPanel] Failed to load scenarios:', err);
        } finally {
            this._loading = false;
        }
    }

    private async _handleSelect(scenario: ScenarioItem) {
        const isSelected = this._selectedPaths.has(scenario.path);

        if (isSelected) {
            // 取消选中
            this._selectedPaths.delete(scenario.path);
            this._selectedPaths = new Set(this._selectedPaths);

            this.dispatchEvent(
                new CustomEvent('rtc-scenario-selected', {
                    bubbles: true,
                    composed: true,
                    detail: {
                        scenario: {title: scenario.name, filepath: scenario.path, file_content: ''},
                        selected: false,
                    },
                })
            );
        } else {
            // 选中：读取文件内容
            try {
                const content = await virtualFS.read(scenario.path);
                const scenarioRef: ScenarioRef = {
                    title: scenario.name,
                    filepath: scenario.path,
                    file_content: content,
                };

                this._selectedPaths.add(scenario.path);
                this._selectedPaths = new Set(this._selectedPaths);

                this.dispatchEvent(
                    new CustomEvent('rtc-scenario-selected', {
                        bubbles: true,
                        composed: true,
                        detail: {scenario: scenarioRef, selected: true},
                    })
                );
            } catch (err) {
                console.warn('[RtcScenarioPanel] Failed to read scenario content:', err);
            }
        }
    }

    render() {
        if (this._loading) {
            return html`<div class="scenario-loading" part="loading">${msg('加载中...')}</div>`;
        }

        if (this._scenarios.length === 0) {
            return html`<div class="scenario-empty" part="empty">${msg('暂无场景')}</div>`;
        }

        return html`
            <div class="scenario-list" part="list">
                ${this._scenarios.map(
                    (scenario) => html`
                        <div
                            class="scenario-item ${classMap({selected: this._selectedPaths.has(scenario.path)})}"
                            @click=${() => this._handleSelect(scenario)}
                        >
                            <span class="scenario-check">${this._selectedPaths.has(scenario.path) ? '✓' : ''}</span>
                            <span class="scenario-text">
                                <span class="scenario-label">${scenario.name}</span>
                                ${scenario.description ? html`<span class="scenario-desc">${scenario.description}</span>` : ''}
                            </span>
                        </div>
                    `
                )}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-scenario-panel': RtcScenarioPanel;
    }
}
