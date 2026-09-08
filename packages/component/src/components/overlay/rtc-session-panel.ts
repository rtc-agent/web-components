/**
 * RTC Session Panel Component
 *
 * Floating panel showing session list for selection.
 *
 * @element rtc-session-panel
 * @fires rtc-session-selected - User clicked a session (detail: { sessionId })
 * @fires rtc-session-rename-requested - User clicked edit (detail: { sessionId })
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
import {editIcon, deleteIcon} from '../../icons/index.js';

@localized()
@customElement('rtc-session-panel')
export class RtcSessionPanel extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[RtcSessionPanel] Locale context not initialized');
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

    private _handleSelect(session: Session) {
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
        this.dispatchEvent(
            new CustomEvent('rtc-session-rename-requested', {
                bubbles: true,
                composed: true,
                detail: {sessionId: session.clientId},
            })
        );
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
              </div>
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
