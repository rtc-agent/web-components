/**
 * RTC File Thumbnail Component
 *
 * Compact file thumbnail for paste preview and message display.
 * Shows image preview with object-fit: cover, or text file icon.
 * Hover reveals delete button (edit mode only).
 * Supports loading skeleton and error states.
 *
 * @element rtc-file-thumbnail
 * @fires rtc-thumbnail-click - Thumbnail clicked (preview requested)
 * @fires rtc-thumbnail-remove - Delete button clicked
 * @fires rtc-thumbnail-retry - Retry button clicked (error state)
 * @csspart thumbnail - The thumbnail container
 * @csspart remove-btn - The delete button
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg, str} from '@lit/localize';
import {styles} from './rtc-file-thumbnail.styles.js';
import {createLogger} from '@rtc-agent/client';
import {FileStorageContext, type FileStorageContextValue} from '../../contexts/file-storage.js';
import {parseFileId} from '../../utils/file-id.js';
import type {FileAttachment} from '../../types/index.js';

const log = createLogger('FileThumbnail');

/** Thumbnail loading state */
type LoadingState = 'idle' | 'loading' | 'loaded' | 'error';

@localized()
@customElement('rtc-file-thumbnail')
export class RtcFileThumbnail extends LitElement {
  static styles = styles;

  /** File URL (for images) */
  @property({type: String})
  src: string = '';

  /** MIME type */
  @property({type: String})
  mimetype: string = '';

  /** File name */
  @property({type: String})
  filename: string = '';

  /** File size in bytes */
  @property({type: Number})
  filesize: number = 0;

  /** Upload task ID (for progress tracking) */
  @property({type: String})
  taskId: string = '';

  /** Upload progress (0-100) */
  @property({type: Number})
  progress: number = 0;

  /** Loading state */
  @property({type: String})
  loadingState: LoadingState = 'idle';

  /** Error message */
  @property({type: String})
  errorMessage: string = '';

  /** Sync status (for offline uploads) */
  @property({type: String})
  syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed';

  /** Readonly mode (no delete button) */
  @property({type: Boolean, reflect: true})
  readonly: boolean = false;

  /** File attachment (preferred over src for self-contained loading) */
  @property({type: Object})
  file: FileAttachment | null = null;

  @consume({context: FileStorageContext, subscribe: true})
  @state()
  private _fileStorageCtx: FileStorageContextValue = {fileStorage: null};

  @state()
  private _thumbnailUrl: string = '';

  @state()
  private _imageError: boolean = false;

  /** Check if MIME type is image */
  private _isImage(mimetype: string): boolean {
    return mimetype.startsWith('image/');
  }

  /** Handle thumbnail click */
  private _handleClick(): void {
    this.dispatchEvent(
      new CustomEvent('rtc-thumbnail-click', {
        bubbles: true,
        composed: true,
        detail: {taskId: this.taskId},
      })
    );
  }

  /** Handle delete button click */
  private _handleRemove(e: Event): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('rtc-thumbnail-remove', {
        bubbles: true,
        composed: true,
        detail: {taskId: this.taskId},
      })
    );
  }

  /** Handle retry button click */
  private _handleRetry(e: Event): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('rtc-thumbnail-retry', {
        bubbles: true,
        composed: true,
        detail: {taskId: this.taskId},
      })
    );
  }

  /** Handle image load error */
  private _handleImageError(): void {
    this._imageError = true;
    log.warn(`Image load failed for ${this.filename}`);
  }

  /** Lifecycle: trigger thumbnail loading when file changes */
  updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    if (changed.has('file')) {
      this._loadThumbnail();
    }
  }

  /** Lifecycle: cleanup blob URL references */
  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.file && this._thumbnailUrl.startsWith('blob:')) {
      try {
        this._fileStorageCtx.fileStorage?.releaseThumbnailUrl(
          parseFileId(this.file.fileid)
        );
      } catch (err) {
        log.warn('Failed to release thumbnail URL:', err);
      }
    }
  }

  /** Load thumbnail URL from FileStorage or use src fallback */
  private async _loadThumbnail(): Promise<void> {
    // Backward compatibility: if src is provided, use it directly
    if (this.src) {
      this._thumbnailUrl = this.src;
      return;
    }

    // If no file or not an image, clear thumbnail
    if (!this.file || !this.file.mimetype.startsWith('image/')) {
      this._thumbnailUrl = '';
      return;
    }

    // If no FileStorage available, cannot load
    const fileStorage = this._fileStorageCtx.fileStorage;
    if (!fileStorage) {
      this._thumbnailUrl = '';
      return;
    }

    try {
      const {md5, ext} = parseFileId(this.file.fileid);
      this._thumbnailUrl = await fileStorage.getThumbnailUrl({md5, ext});
    } catch (err) {
      log.warn('Failed to load thumbnail:', err);
      this._thumbnailUrl = '';
    }
  }

  /** Render thumbnail content */
  private _renderThumbnail() {
    // Error state
    if (this.loadingState === 'error' || this._imageError) {
      return html`
        <div class="thumb-error" role="img" aria-label=${msg('加载失败')}>
          <span class="error-icon">⚠️</span>
          <button
            class="retry-btn"
            aria-label=${msg('重试上传')}
            @click=${this._handleRetry}
          >${msg('点击重试')}</button>
        </div>
      `;
    }

    // Loading state (skeleton)
    if (this.loadingState === 'loading') {
      return html`<div class="thumb-skeleton" aria-label=${msg('加载中...')}></div>`;
    }

    // Image file
    const imageUrl = this._thumbnailUrl || this.src;
    if (this._isImage(this.mimetype) && imageUrl) {
      return html`
        <img
          class="thumb-img"
          src=${imageUrl}
          loading="lazy"
          alt=${this.filename}
          @error=${this._handleImageError}
        />
      `;
    }

    // Text file (icon)
    return html`<div class="thumb-icon">📄</div>`;
  }

  /** Render circular progress overlay */
  private _renderProgressBar() {
    if (this.loadingState !== 'loading') return nothing;

    const radius = 8;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (this.progress / 100) * circumference;

    return html`
      <div class="progress-overlay">
        <svg class="progress-ring" viewBox="0 0 20 20">
          <circle
            class="progress-ring-circle"
            cx="10"
            cy="10"
            r="${radius}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
          />
        </svg>
        <span class="progress-text">${this.progress}%</span>
      </div>
    `;
  }

  /** Render sync status badge */
  private _renderSyncBadge() {
    if (!this.syncStatus || this.syncStatus === 'synced') return nothing;

    const badges = {
      pending: {icon: '⏳', label: msg('等待同步')},
      syncing: {icon: '🔄', label: msg('正在同步...')},
      failed: {icon: '❌', label: msg('同步失败')},
    };
    const badge = badges[this.syncStatus as keyof typeof badges];
    if (!badge) return nothing;

    return html`
      <div class="sync-badge" title=${badge.label} aria-label=${badge.label}>
        ${badge.icon}
      </div>
    `;
  }

  /** Render delete button */
  private _renderRemoveButton() {
    if (this.readonly) return nothing;
    return html`
      <button
        class="remove-btn"
        part="remove-btn"
        aria-label=${msg(str`删除 ${this.filename}`)}
        @click=${this._handleRemove}
      >✕</button>
    `;
  }

  /** Render filename overlay */
  private _renderFilename() {
    if (!this.filename) return nothing;
    return html`
      <div class="filename" title=${this.filename}>
        ${this.filename}
      </div>
    `;
  }

  render() {
    return html`
      <div
        class="thumbnail"
        part="thumbnail"
        role="listitem"
        tabindex="0"
        aria-label=${msg(str`预览 ${this.filename}`)}
        @click=${this._handleClick}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._handleClick();
          }
        }}
      >
        ${this._renderThumbnail()}
        ${this._renderProgressBar()}
        ${this._renderSyncBadge()}
        ${this._renderFilename()}
        ${this._renderRemoveButton()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-file-thumbnail': RtcFileThumbnail;
  }
}
