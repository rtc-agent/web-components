/**
 * RTC File Preview Area Component
 *
 * Horizontal scrolling container for file thumbnails.
 * Renders rtc-file-thumbnail for each file attachment.
 * Supports edit mode (with delete) and readonly mode (message display).
 *
 * @element rtc-file-preview-area
 * @fires rtc-file-remove - File removed (edit mode only)
 * @fires rtc-file-preview - File preview requested
 * @csspart preview-area - The scrolling container
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {styles} from './rtc-file-preview-area.styles.js';
import type {FileAttachment} from '../../types/index.js';
import './rtc-file-thumbnail.js';

@localized()
@customElement('rtc-file-preview-area')
export class RtcFilePreviewArea extends LitElement {
  static styles = styles;

  /** File attachments to display */
  @property({type: Array})
  files: FileAttachment[] = [];

  /** Readonly mode (no delete buttons) */
  @property({type: Boolean, reflect: true})
  readonly: boolean = false;

  /** Upload task progress map (taskId -> progress 0-100) */
  @property({type: Object})
  uploadProgress: Map<string, number> = new Map();

  /** Upload task loading state map (taskId -> state) */
  @property({type: Object})
  uploadStates: Map<string, string> = new Map();

  /** Local preview URLs for image files (taskId -> blob URL) */
  @property({type: Object})
  localPreviews: Map<string, string> = new Map();

  @state()
  private _resizeObserver?: ResizeObserver;

  connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width < 360) {
          this.setAttribute('data-responsive', 'sm');
        } else if (width > 480) {
          this.setAttribute('data-responsive', 'lg');
        } else {
          this.setAttribute('data-responsive', 'md');
        }
      }
    });
    this._resizeObserver.observe(this);
    this._updateEmptyState();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  updated(changed: Map<string | number | symbol, unknown>): void {
    if (changed.has('files')) {
      this._updateEmptyState();
    }
  }

  private _updateEmptyState(): void {
    if (this.files.length === 0) {
      this.setAttribute('data-empty', 'true');
    } else {
      this.removeAttribute('data-empty');
    }
  }

  /** Generate thumbnail src URL for image files */
  private _getThumbnailSrc(file: FileAttachment): string {
    if (!file.mimetype.startsWith('image/')) return '';
    // Use local preview URL (blob URL from parent component)
    return this.localPreviews.get(file.fileid) ?? '';
  }

  /** Get filename from FileAttachment.extra */
  private _getFilename(file: FileAttachment): string {
    return (file.extra?.name as string) ?? 'untitled';
  }

  /** Get filesize from FileAttachment.extra */
  private _getFilesize(file: FileAttachment): number {
    return (file.extra?.size as number) ?? 0;
  }

  /** Handle thumbnail click */
  private _handleThumbnailClick(_e: CustomEvent, file: FileAttachment, index: number): void {
    this.dispatchEvent(
      new CustomEvent('rtc-file-preview', {
        bubbles: true,
        composed: true,
        detail: {file, index},
      })
    );
  }

  /** Handle thumbnail remove */
  private _handleThumbnailRemove(_e: CustomEvent, file: FileAttachment, index: number): void {
    this.dispatchEvent(
      new CustomEvent('rtc-file-remove', {
        bubbles: true,
        composed: true,
        detail: {file, index},
      })
    );
  }

  /** Handle thumbnail retry */
  private _handleThumbnailRetry(_e: CustomEvent, file: FileAttachment, index: number): void {
    // Dispatch retry event for parent to handle
    this.dispatchEvent(
      new CustomEvent('rtc-file-retry', {
        bubbles: true,
        composed: true,
        detail: {file, index},
      })
    );
  }

  render() {
    if (this.files.length === 0) {
      return html`
        <div class="empty-state" part="empty-state">
          ${msg('没有附件')}
        </div>
      `;
    }

    return html`
      <div class="file-preview-area" part="preview-area" role="list" aria-label=${msg('附件列表')}>
        ${this.files.map((file, index) => {
          const taskId = file.fileid;
          const progress = this.uploadProgress.get(taskId) ?? 0;
          const loadingState = this.uploadStates.get(taskId) ?? 'loaded';

          return html`
            <rtc-file-thumbnail
              .src=${this._getThumbnailSrc(file)}
              .mimetype=${file.mimetype}
              .filename=${this._getFilename(file)}
              .filesize=${this._getFilesize(file)}
              .taskId=${taskId}
              .progress=${progress}
              .loadingState=${loadingState}
              .readonly=${this.readonly}
              @rtc-thumbnail-click=${(e: CustomEvent) => this._handleThumbnailClick(e, file, index)}
              @rtc-thumbnail-remove=${(e: CustomEvent) => this._handleThumbnailRemove(e, file, index)}
              @rtc-thumbnail-retry=${(e: CustomEvent) => this._handleThumbnailRetry(e, file, index)}
            ></rtc-file-thumbnail>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-file-preview-area': RtcFilePreviewArea;
  }
}
