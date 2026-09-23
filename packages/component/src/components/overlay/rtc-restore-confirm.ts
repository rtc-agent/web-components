/**
 * RTC Restore Confirm Component
 *
 * Modal dialog asking user to confirm restoring a file to its default content.
 * Two actions: Cancel (dismiss) or Confirm (restore to default).
 *
 * @element rtc-restore-confirm
 * @fires rtc-restore-confirmed - User confirmed the restore
 * @fires rtc-restore-cancelled - User cancelled the restore
 * @csspart backdrop - The backdrop overlay
 * @csspart dialog - The dialog card
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-restore-confirm.styles.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('RestoreConfirm');

@localized()
@customElement('rtc-restore-confirm')
export class RtcRestoreConfirm extends LitElement {
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

    /** The file path being restored */
    @property({type: String})
    filePath = '';

    private _confirm() {
        this.dispatchEvent(
            new CustomEvent('rtc-restore-confirmed', {
                bubbles: true,
                composed: true,
                detail: {filePath: this.filePath},
            })
        );
    }

    private _cancel() {
        this.dispatchEvent(
            new CustomEvent('rtc-restore-cancelled', {
                bubbles: true,
                composed: true,
                detail: {filePath: this.filePath},
            })
        );
    }

    private _onBackdropClick(e: Event) {
        // Only close if the backdrop itself was clicked (not the dialog)
        if ((e.target as HTMLElement).classList.contains('backdrop')) {
            this._cancel();
        }
    }

    render() {
        void this._localeCtx.locale;
        return html`
      <div class="backdrop" part="backdrop" @click=${this._onBackdropClick}></div>
      <div class="dialog" part="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-desc">
        <div class="dialog-title" id="dialog-title">${msg("恢复默认内容")}</div>
        <div class="dialog-desc" id="dialog-desc">
          ${msg("此操作将覆盖您的编辑，恢复为默认内容。此操作不可撤销。")}
        </div>
        <div class="file-path">${this.filePath}</div>
        <div class="actions">
          <button class="action-btn" @click=${this._cancel}>${msg("取消")}</button>
          <button class="action-btn danger" @click=${this._confirm}>${msg("确认恢复")}</button>
        </div>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-restore-confirm': RtcRestoreConfirm;
    }

    interface HTMLElementEventMap {
        'rtc-restore-confirmed': CustomEvent<{filePath: string}>;
        'rtc-restore-cancelled': CustomEvent<{filePath: string}>;
    }
}
