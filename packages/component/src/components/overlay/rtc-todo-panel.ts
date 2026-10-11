/**
 * RTC Todo Panel Component
 *
 * Floating panel displaying the current session's task list.
 * Supports filtering by status and shows progress indicators.
 *
 * @element rtc-todo-panel
 * @fires rtc-todo-filter-changed - Filter changed (detail: { filter })
 * @csspart list - The todo list container
 * @csspart filter - The filter bar
 */
import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { consume } from '@lit/context';
import {
  localeContext,
  type LocaleContextValue,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
import { styles } from './rtc-todo-panel.styles.js';
import type { TodoItem } from '../../types/index.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('TodoPanel');

/** Filter options for todo list */
type TodoFilter = 'all' | 'pending' | 'in_progress' | 'completed';

/**
 * Deep comparison for TodoItem arrays to avoid unnecessary re-renders.
 */
function todoListChanged(
  newVal: TodoItem[],
  oldVal: TodoItem[] | undefined,
): boolean {
  if (!oldVal) return true;
  if (newVal === oldVal) return false;
  if (newVal.length !== oldVal.length) return true;
  return newVal.some(
    (v, i) =>
      v.content !== oldVal[i].content ||
      v.status !== oldVal[i].status ||
      v.active_form !== oldVal[i].active_form,
  );
}

@localized()
@customElement('rtc-todo-panel')
export class RtcTodoPanel extends LitElement {
  static styles = styles;

  @consume({ context: localeContext, subscribe: true })
  @state()
  private _localeCtx: LocaleContextValue = {
    locale: sourceLocale,
    setLocale: async () => {
      log.warn('Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  @property({ type: Array, hasChanged: todoListChanged })
  todoList: TodoItem[] = [];

  /** Current filter state */
  @state()
  private _filter: TodoFilter = 'all';

  /**
   * Filtered todo list based on current filter.
   */
  private get _filteredTodos(): TodoItem[] {
    if (this._filter === 'all') return this.todoList;
    return this.todoList.filter((item) => item.status === this._filter);
  }

  /**
   * Count of todos by status for filter badges.
   */
  private get _statusCounts(): Record<TodoFilter, number> {
    const counts = { all: this.todoList.length, pending: 0, in_progress: 0, completed: 0 };
    for (const item of this.todoList) {
      if (item.status === 'pending') counts.pending++;
      else if (item.status === 'in_progress') counts.in_progress++;
      else if (item.status === 'completed') counts.completed++;
    }
    return counts;
  }

  /**
   * Progress percentage for the progress bar.
   */
  private get _progressPercent(): number {
    if (this.todoList.length === 0) return 0;
    return Math.round((this._statusCounts.completed / this.todoList.length) * 100);
  }

  private _setFilter(filter: TodoFilter) {
    this._filter = filter;
    this.dispatchEvent(
      new CustomEvent('rtc-todo-filter-changed', {
        bubbles: true,
        composed: true,
        detail: { filter },
      }),
    );
  }

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

  private _renderFilterBar() {
    const counts = this._statusCounts;
    const filters: { key: TodoFilter; label: string }[] = [
      { key: 'all', label: msg('全部') },
      { key: 'pending', label: msg('待办') },
      { key: 'in_progress', label: msg('进行中') },
      { key: 'completed', label: msg('已完成') },
    ];

    return html`
      <div class="filter-bar" part="filter" role="tablist">
        ${filters.map(
          (f) => html`
            <button
              class=${classMap({
                'filter-chip': true,
                active: this._filter === f.key,
              })}
              role="tab"
              aria-selected=${this._filter === f.key}
              @click=${() => this._setFilter(f.key)}
            >
              ${f.label}
              <span class="filter-count">${counts[f.key]}</span>
            </button>
          `,
        )}
      </div>
    `;
  }

  private _renderProgressBar() {
    const progress = this._progressPercent;
    const counts = this._statusCounts;

    return html`
      <div class="progress-section">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="progress-stats">
          <span class="progress-text">${msg(str`${counts.completed} / ${counts.all} 已完成`)}</span>
          <span class="progress-percent">${progress}%</span>
        </div>
      </div>
    `;
  }

  render() {
    void this._localeCtx.locale;
    if (this.todoList.length === 0) {
      return html`<div class="empty-text" aria-live="polite">${msg('暂无任务')}</div>`;
    }

    const filtered = this._filteredTodos;
    const counts = this._statusCounts;

    // Auto-hide filter bar if all items have the same status
    const hasMultipleStatuses =
      (counts.pending > 0 ? 1 : 0) +
        (counts.in_progress > 0 ? 1 : 0) +
        (counts.completed > 0 ? 1 : 0) >
      1;

    return html`
      ${this._renderProgressBar()}
      ${hasMultipleStatuses ? this._renderFilterBar() : nothing}
      <div class="todo-list" part="list" role="list" aria-label="${msg('任务列表')}">
        ${filtered.length === 0
          ? html`<div class="empty-filter">${msg('没有匹配的任务')}</div>`
          : repeat(
              filtered,
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
                    ${
                      item.status === 'in_progress' && item.active_form
                        ? html`<span class="todo-active-form">${item.active_form}</span>`
                        : nothing
                    }
                  </div>
                </div>
              `,
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
