/**
 * RTC Session Panel Component
 *
 * Floating panel showing session list for selection.
 * Supports inline rename (edit button -> input field -> Enter/confirm to save).
 *
 * @element rtc-session-panel
 * @fires rtc-session-selected - User clicked a session (detail: { sessionId })
 * @fires rtc-session-rename-confirmed - User confirmed inline rename (detail: { sessionId, title })
 * @fires rtc-session-delete-requested - User clicked delete (detail: { sessionId })
 * @csspart list - The session list container
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {repeat} from 'lit/directives/repeat.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-session-panel.styles.js';
import type {Session} from '../../types/index.js';
import {editIcon, deleteIcon, checkIcon, closeIcon} from '../../icons/index.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('SessionPanel');

@localized()
@customElement('rtc-session-panel')
export class RtcSessionPanel extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: Array})
    sessions: Session[] = [];

    @property({type: String, attribute: 'current-session-id'})
    currentSessionId: string | null = null;

    /** 主题（继承自父级） */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /** Session currently being renamed (null if none). */
    @state()
    private _renamingSessionId: string | null = null;

    /** Current value of the rename input. */
    @state()
    private _renameValue = '';

    private _handleSelect(session: Session) {
        // Don't select while renaming — let the rename interaction complete first.
        if (this._renamingSessionId === session.clientId) return;
        this.dispatchEvent(
            new CustomEvent('rtc-session-selected', {
                bubbles: true,
                composed: true,
                detail: {sessionId: session.clientId},
            })
        );
    }

    private _handleRename(session: Session, e: Event) {
        e.stopPropagation();
        this._renamingSessionId = session.clientId;
        this._renameValue = session.title || '';
        // Focus the input after render.
        this.updateComplete.then(() => {
            const input = this.shadowRoot?.querySelector<HTMLInputElement>('.rename-input');
            input?.focus();
            input?.select();
        }).catch(err => {
            log.error('Rename input focus after update failed:', err);
        });
    }

    private _handleRenameConfirm() {
        const sessionId = this._renamingSessionId;
        const title = this._renameValue.trim();
        this._renamingSessionId = null;
        this._renameValue = '';

        if (!sessionId || !title) return;

        this.dispatchEvent(
            new CustomEvent('rtc-session-rename-confirmed', {
                bubbles: true,
                composed: true,
                detail: {sessionId, title},
            })
        );
    }

    private _handleRenameCancel() {
        this._renamingSessionId = null;
        this._renameValue = '';
    }

    private _handleRenameKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this._handleRenameConfirm();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this._handleRenameCancel();
        }
    }

    private _handleDelete(session: Session, e: Event) {
        e.stopPropagation();
        this.dispatchEvent(
            new CustomEvent('rtc-session-delete-requested', {
                bubbles: true,
                composed: true,
                detail: {sessionId: session.clientId},
            })
        );
    }

    render() {
        void this._localeCtx.locale;
        if (this.sessions.length === 0) {
            return html`<div class="empty-text">${msg('No sessions yet')}</div>`;
        }

        return html`
      <div class="session-list" part="list">
        ${repeat(
            this.sessions,
            (s) => s.clientId,
            (s) => html`
            <div
              class="session-item ${classMap({active: s.clientId === this.currentSessionId})}"
              @click=${() => this._handleSelect(s)}
            >
              ${this._renamingSessionId === s.clientId
                ? html`
                    <input
                      class="rename-input"
                      .value=${this._renameValue}
                      @input=${(e: Event) => { this._renameValue = (e.target as HTMLInputElement).value; }}
                      @keydown=${(e: KeyboardEvent) => this._handleRenameKeydown(e)}
                      @blur=${() => this._handleRenameConfirm()}
                      @click=${(e: Event) => e.stopPropagation()}
                    />
                    <div class="session-actions rename-actions">
                      <button class="session-action-btn confirm-btn"
                        @click=${(e: Event) => { e.stopPropagation(); this._handleRenameConfirm(); }}
                        title=${msg('确认')}>${checkIcon}
                      </button>
                      <button class="session-action-btn cancel-btn"
                        @click=${(e: Event) => { e.stopPropagation(); this._handleRenameCancel(); }}
                        title=${msg('取消')}>${closeIcon}
                      </button>
                    </div>`
                : html`
                    <div class="session-text">
                      <span class="session-title">${s.title || msg('Untitled')}</span>
                      <span class="session-time">${new Date(s.updatedAt).toLocaleString()}</span>
                    </div>
                    <div class="session-actions">
                      <button class="session-action-btn" data-action="rename"
                        @click=${(e: Event) => this._handleRename(s, e)}
                        title=${msg('编辑')}>${editIcon}
                      </button>
                      <button class="session-action-btn" data-action="delete"
                        @click=${(e: Event) => this._handleDelete(s, e)}
                        title=${msg('删除')}>${deleteIcon}
                      </button>
                    </div>`}
            </div>
          `
        )}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-session-panel': RtcSessionPanel;
    }
}
