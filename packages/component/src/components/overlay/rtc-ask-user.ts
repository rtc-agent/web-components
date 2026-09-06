/**
 * AskUser Dialog Component
 *
 * Renders LLM-provided multiple-choice questions, collects user selections,
 * and emits a submit/dismiss event. Designed to match the ask-user-mockup.html
 * spec:
 *   - 1 question → no tab bar, direct form, auto height
 *   - 2-4 questions → chip tab bar, fixed 520px height, Prev/Next nav
 *
 * @element rtc-ask-user
 * @fires rtc-ask-user-submit - User submitted answers
 *   detail: { clientId: string, payload: { answers, annotations?, metadata? } }
 * @fires rtc-ask-user-dismiss - User cancelled / dismissed
 *   detail: { clientId: string }
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import type {PropertyValues} from 'lit';
import {styles} from './rtc-ask-user.styles.js';
import type {LocalRtc} from '@rtc-agent/persistence';

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect?: boolean;
}

export interface AskUserOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserPayload {
  answers: Record<string, string>;
  annotations?: Record<string, {preview?: string; notes?: string}>;
  metadata?: {source?: string};
}

/** Sentinel index for the auto-appended "Other" option. */
const OTHER_INDEX = -1;

@customElement('rtc-ask-user')
export class RtcAskUser extends LitElement {
  static styles = styles;

  /** The RTC record; parameters.questions carries the question list. */
  @property({type: Object})
  rtc: LocalRtc | null = null;

  /** Parsed questions (derived from rtc.parameters.questions). */
  @state() private _questions: AskUserQuestion[] = [];

  /** Active tab index (multi-question only). */
  @state() private _currentTab = 0;

  /**
   * Selections per question: questionIndex → array of selected option indices.
   * "Other" is represented by OTHER_INDEX (-1).
   */
  @state() private _selections: Record<number, number[]> = {};

  /** Free-form text typed into "Other" per question. */
  @state() private _otherTexts: Record<number, string> = {};

  /**
   * Parse questions BEFORE render so the first paint already contains them.
   * Using willUpdate() (rather than updated()) avoids an extra update cycle:
   * setting _questions here is reflected in the same render pass.
   */
  willUpdate(changed: PropertyValues) {
    if (changed.has('rtc') && this.rtc) {
      this._parseQuestions();
    }
  }

  private _parseQuestions() {
    const params = (this.rtc?.parameters as { questions?: AskUserQuestion[] } | undefined) || {};
    const questions = Array.isArray(params.questions) ? params.questions : [];
    this._questions = questions;
    this._currentTab = 0;
    this._selections = {};
    this._otherTexts = {};
  }

  private get _isMulti(): boolean {
    return this._questions.length > 1;
  }

  /** Whether at least one question has a non-empty answer. */
  private get _canSubmit(): boolean {
    return this._questions.some((_, qi) => {
      const sel = this._selections[qi] || [];
      if (sel.length === 0) return false;
      // If the only selection is "Other", require non-empty text.
      if (sel.length === 1 && sel[0] === OTHER_INDEX) {
        return (this._otherTexts[qi] || '').trim().length > 0;
      }
      return true;
    });
  }

  // ────────────────────────── Selection logic ──────────────────────────

  private _selectOption(qIdx: number, optIdx: number, e?: Event) {
    // If the click is on the Other input field, let it handle normally
    // (don't toggle selection or prevent default focus behavior).
    if (e) {
      const target = e.target as HTMLElement;
      if (target.classList.contains('other-input')) {
        return;
      }
    }

    // Prevent the native label→input synthetic click. Without this, clicking
    // the label fires _selectOption twice (once from the label, once from the
    // synthesized click on the wrapped input) — select + deselect = no-op.
    e?.preventDefault();
    e?.stopPropagation();

    const q = this._questions[qIdx];
    if (!q) return;

    const current = this._selections[qIdx] || [];
    let next: number[];

    if (q.multiSelect) {
      // Toggle
      next = current.includes(optIdx)
        ? current.filter(i => i !== optIdx)
        : [...current, optIdx];
    } else {
      // Single-select: replace (clicking same again deselects)
      next = current[0] === optIdx ? [] : [optIdx];
    }

    this._selections = { ...this._selections, [qIdx]: next };
  }

  private _onOtherInput(qIdx: number, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this._otherTexts = { ...this._otherTexts, [qIdx]: value };
  }

  /**
   * Resolve the display answer string for a question.
   * For "Other", uses the typed text. For regular options, uses the label.
   */
  private _answerFor(qIdx: number): string | null {
    const sel = this._selections[qIdx] || [];
    if (sel.length === 0) return null;
    const q = this._questions[qIdx];

    const parts: string[] = [];
    for (const idx of sel) {
      if (idx === OTHER_INDEX) {
        const txt = (this._otherTexts[qIdx] || '').trim();
        if (txt) parts.push(txt);
      } else if (q.options[idx]) {
        parts.push(q.options[idx].label);
      }
    }
    return parts.length > 0 ? parts.join(', ') : null;
  }

  // ────────────────────────── Actions ──────────────────────────

  private _submit() {
    if (!this._canSubmit || !this.rtc) return;

    const answers: Record<string, string> = {};
    const annotations: Record<string, {preview?: string; notes?: string}> = {};

    for (let qi = 0; qi < this._questions.length; qi++) {
      const q = this._questions[qi];
      const answer = this._answerFor(qi);
      if (answer === null) continue;

      answers[q.question] = answer;

      // Capture preview from the first selected non-Other option (if any).
      const sel = this._selections[qi] || [];
      const previewOpt = sel
        .map(i => (i === OTHER_INDEX ? null : q.options[i]))
        .find(o => o && o.preview);
      if (previewOpt?.preview) {
        annotations[q.question] = { preview: previewOpt.preview };
      }
    }

    const payload: AskUserPayload = {
      answers,
      metadata: { source: 'rtc-ask-user' },
    };
    if (Object.keys(annotations).length > 0) {
      payload.annotations = annotations;
    }

    this.dispatchEvent(
      new CustomEvent('rtc-ask-user-submit', {
        bubbles: true,
        composed: true,
        detail: { clientId: this.rtc!.client_id, payload },
      })
    );
  }

  private _dismiss() {
    if (!this.rtc) return;
    this.dispatchEvent(
      new CustomEvent('rtc-ask-user-dismiss', {
        bubbles: true,
        composed: true,
        detail: { clientId: this.rtc.client_id },
      })
    );
  }

  // ────────────────────────── Navigation ──────────────────────────

  private _goTab(idx: number) {
    if (idx < 0 || idx >= this._questions.length) return;
    this._currentTab = idx;
  }

  private _onKeyDown(e: KeyboardEvent) {
    // ESC dismisses
    if (e.key === 'Escape') {
      e.preventDefault();
      this._dismiss();
      return;
    }
    // Enter submits if possible
    if (e.key === 'Enter' && this._canSubmit) {
      // Don't steal Enter from the Other text input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      this._submit();
    }
  }

  // ────────────────────────── Render ──────────────────────────

  render() {
    const questions = this._questions;
    if (questions.length === 0) {
      return html`<div class="backdrop" @click=${this._dismiss}></div>`;
    }

    const multi = this._isMulti;
    const title = multi
      ? `Answer ${questions.length} questions`
      : 'Answer a question';

    return html`
      <div class="backdrop" @click=${this._dismiss}></div>
      <div
        class="dialog ${multi ? 'multi' : ''}"
        role="dialog"
        aria-modal="true"
        aria-label=${title}
        @keydown=${this._onKeyDown}
      >
        ${this._renderHeader(title)}
        ${multi ? this._renderTabBar() : nothing}
        ${multi ? this._renderTabContent() : this._renderQuestion(0)}
        ${multi ? html`<div class="progress">Question ${this._currentTab + 1} of ${questions.length}</div>` : nothing}
        ${this._renderActions()}
      </div>
    `;
  }

  private _renderHeader(title: string) {
    return html`
      <div class="dialog-header">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <div class="dialog-title">${title}</div>
      </div>
    `;
  }

  private _renderTabBar() {
    return html`
      <div class="tab-bar" role="tablist">
        ${this._questions.map((q, i) => html`
          <button
            class="tab-chip"
            role="tab"
            aria-selected=${i === this._currentTab}
            @click=${() => this._goTab(i)}
          >${q.header}</button>
        `)}
      </div>
    `;
  }

  private _renderTabContent() {
    return html`
      <div class="tab-content">
        ${this._questions.map((_, i) => html`
          <div class="tab-pane" ?hidden=${i !== this._currentTab}>
            ${this._renderQuestion(i)}
          </div>
        `)}
      </div>
    `;
  }

  private _renderQuestion(qIdx: number) {
    const q = this._questions[qIdx];
    if (!q) return nothing;

    const sel = new Set(this._selections[qIdx] || []);
    const isMulti = !!q.multiSelect;
    const inputType = isMulti ? 'checkbox' : 'radio';
    const indicatorClass = isMulti ? 'checkbox' : 'radio';

    // Preview: show for the currently-selected option that has one.
    const selectedOpts = (this._selections[qIdx] || [])
      .filter(i => i !== OTHER_INDEX)
      .map(i => q.options[i])
      .filter(Boolean);
    const previewOpt = selectedOpts.find(o => o.preview);

    return html`
      <div class="question">
        <div class="question-head">
          <span class="chip">${q.header}</span>
          <p class="question-text">${q.question}</p>
        </div>
        <div class="options" role="${isMulti ? 'group' : 'radiogroup'}">
          ${q.options.map((opt, oi) => this._renderOption(qIdx, oi, opt, inputType, indicatorClass, sel.has(oi)))}
          ${this._renderOther(qIdx, inputType, indicatorClass, sel.has(OTHER_INDEX))}
        </div>
        ${previewOpt?.preview ? html`
          <div class="preview-label">Preview${previewOpt.label ? ` · ${previewOpt.label}` : ''}</div>
          <div class="preview-panel">${previewOpt.preview}</div>
        ` : nothing}
      </div>
    `;
  }

  private _renderOption(
    qIdx: number,
    optIdx: number,
    opt: AskUserOption,
    inputType: string,
    indicatorClass: string,
    selected: boolean,
  ) {
    // Detect "(Recommended)" in the description to render as a styled tag.
    const recMatch = opt.description.match(/\(Recommended\)\s*/i);
    const descWithoutRec = recMatch
      ? opt.description.replace(recMatch[0], '').trim()
      : opt.description;

    return html`
      <label
        class="option ${indicatorClass} ${selected ? 'selected' : ''}"
        @click=${(e: Event) => this._selectOption(qIdx, optIdx, e)}
      >
        <input type="${inputType}" name="q-${qIdx}" .checked=${selected}>
        <span class="indicator"></span>
        <div class="option-body">
          <div class="option-label">
            ${opt.label}
            ${recMatch ? html`<span class="rec">(Recommended)</span>` : nothing}
          </div>
          <div class="option-desc">${descWithoutRec}</div>
        </div>
      </label>
    `;
  }

  private _renderOther(
    qIdx: number,
    inputType: string,
    indicatorClass: string,
    selected: boolean,
  ) {
    // Render the text input OUTSIDE the label to prevent the label from
    // stealing focus (labels redirect focus to their first form control).
    return html`
      <div class="option-wrapper ${selected ? 'selected' : ''}">
        <label
          class="option ${indicatorClass} other ${selected ? 'selected' : ''}"
          @click=${(e: Event) => this._selectOption(qIdx, OTHER_INDEX, e)}
        >
          <input type="${inputType}" name="q-${qIdx}-other" .checked=${selected}>
          <span class="indicator"></span>
          <div class="option-body">
            <div class="option-label">Other</div>
          </div>
        </label>
        ${selected ? html`
          <input
            class="other-input"
            type="text"
            placeholder="Type your answer…"
            .value=${this._otherTexts[qIdx] || ''}
            @input=${(e: Event) => this._onOtherInput(qIdx, e)}
          >
        ` : nothing}
      </div>
    `;
  }

  private _renderActions() {
    const multi = this._isMulti;
    const isFirst = this._currentTab === 0;
    const isLast = this._currentTab >= this._questions.length - 1;

    if (multi) {
      return html`
        <div class="actions">
          <button
            class="action-btn ghost"
            ?disabled=${isFirst}
            @click=${() => this._goTab(this._currentTab - 1)}
          >← Prev</button>
          <button
            class="action-btn ghost"
            style=${isLast ? 'visibility: hidden' : ''}
            @click=${() => this._goTab(this._currentTab + 1)}
          >Next →</button>
          <button
            class="action-btn primary"
            ?disabled=${!this._canSubmit}
            @click=${this._submit}
          >Submit</button>
        </div>
      `;
    }

    return html`
      <div class="actions">
        <button class="action-btn ghost" @click=${this._dismiss}>Cancel</button>
        <button
          class="action-btn primary"
          ?disabled=${!this._canSubmit}
          @click=${this._submit}
        >Submit</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-ask-user': RtcAskUser;
  }
}
