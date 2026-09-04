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
import {LitElement, html, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {repeat} from 'lit/directives/repeat.js';
import {styles} from './rtc-session-panel.styles.js';
import type {Session} from '../../types/index.js';
import {editIcon, deleteIcon} from '../../icons/index.js';

@customElement('rtc-session-panel')
export class RtcSessionPanel extends LitElement {
    static styles = styles;

    @property({type: Array})
    sessions: Session[] = [];

    @property({type: String, attribute: 'current-session-id'})
    currentSessionId: string | null = null;

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
        if (this.sessions.length === 0) {
            return html`<div class="empty-text">No sessions yet</div>`;
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
                <span class="session-title">${s.title || 'Untitled'}</span>
                <span class="session-time">${new Date(s.updatedAt).toLocaleString()}</span>
              </div>
              <div class="session-actions">
                <button class="session-action-btn" data-action="rename"
                  @click=${(e: Event) => this._handleRename(s, e)}
                  title="编辑">${editIcon}
                </button>
                <button class="session-action-btn" data-action="delete"
                  @click=${(e: Event) => this._handleDelete(s, e)}
                  title="删除">${deleteIcon}
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
