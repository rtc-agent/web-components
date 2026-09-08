/**
 * RTC Todo Panel Component
 *
 * Floating panel displaying the current session's task list.
 *
 * @element rtc-todo-panel
 * @csspart list - The todo list container
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {repeat} from 'lit/directives/repeat.js';
import {styles} from './rtc-todo-panel.styles.js';
import type {TodoItem} from '../../types/index.js';

/**
 * Deep comparison for TodoItem arrays to avoid unnecessary re-renders.
 */
function todoListChanged(newVal: TodoItem[], oldVal: TodoItem[] | undefined): boolean {
    if (!oldVal) return true;
    if (newVal === oldVal) return false;
    if (newVal.length !== oldVal.length) return true;
    return newVal.some((v, i) =>
        v.content !== oldVal[i].content ||
        v.status !== oldVal[i].status ||
        v.active_form !== oldVal[i].active_form
    );
}

@localized()
@customElement('rtc-todo-panel')
export class RtcTodoPanel extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-todo-panel] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: Array, hasChanged: todoListChanged})
    todoList: TodoItem[] = [];

    private _renderStatusIcon(status: TodoItem['status']) {
        switch (status) {
            case 'completed':
                return html`<svg viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`;
            case 'in_progress':
                return html`<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3"/></svg>`;
            case 'pending':
            default:
                return html`<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
        }
    }

    render() {
        void this._localeCtx.locale;
        if (this.todoList.length === 0) {
            return html`<div class="empty-text" aria-live="polite">${msg('No tasks yet')}</div>`;
        }

        return html`
      <div class="todo-list" part="list" role="list" aria-label="${msg('Task list')}">
        ${repeat(
            this.todoList,
            (_item, i) => `${i}-${_item.content}`,
            (item) => html`
            <div
              class="todo-item todo-item--${item.status}"
              role="listitem"
            >
              <span class="todo-status-icon todo-status-icon--${item.status}" aria-hidden="true">
                ${this._renderStatusIcon(item.status)}
              </span>
              <div class="todo-text">
                <span class="todo-content">${item.content}</span>
                ${item.status === 'in_progress' && item.active_form
                    ? html`<span class="todo-active-form">${item.active_form}</span>`
                    : nothing}
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
        'rtc-todo-panel': RtcTodoPanel;
    }
}
