/**
 * RTC File Preview Modal Component
 *
 * Full-screen modal overlay for file preview (images and text).
 * Uses teleport pattern: rendered inside parent's shadowRoot with position: fixed
 * to cover the entire host window, without escaping component boundaries.
 *
 * Supports:
 * - Image preview (object-fit: contain, URL.createObjectURL/revokeObjectURL)
 * - Text preview (monospace, pre-wrap, truncation for large files)
 * - Three close methods: ESC key, backdrop click, close button
 * - Graceful degradation: fallback to getPresignedUrl() if download fails
 * - Large file protection: >1MB text truncated to 1000 lines, >10MB rejected
 *
 * @element rtc-file-preview-modal
 * @fires rtc-preview-close - Modal closed
 * @csspart backdrop - The backdrop overlay
 * @csspart content - The modal content container
 * @csspart header - The modal header
 * @csspart body - The modal body
 */
import {LitElement, html, nothing, type PropertyValues} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {styles} from './rtc-file-preview-modal.styles.js';
import {createLogger} from '@rtc-agent/client';
import {FileStorageContext, type FileStorageContextValue} from '../../contexts/file-storage.js';
import type {FileAttachment} from '../../types/index.js';

const log = createLogger('FilePreviewModal');

/** Content loading state */
type ContentState = 'idle' | 'loading' | 'loaded' | 'error' | 'fallback';

/** Maximum text file size for preview (10MB) */
const MAX_TEXT_PREVIEW_SIZE = 10 * 1024 * 1024;

/** Maximum text lines to display (1MB threshold) */
const MAX_TEXT_PREVIEW_LINES = 1000;

/** Approximate byte threshold for text truncation (~1MB) */
const TEXT_TRUNCATION_THRESHOLD = 1024 * 1024;

@localized()
@customElement('rtc-file-preview-modal')
export class RtcFilePreviewModal extends LitElement {
  static styles = styles;

  /* ── Context ── */

  @consume({context: FileStorageContext, subscribe: true})
  @state()
  private _fileStorageCtx: FileStorageContextValue = {fileStorage: null};

  /* ── Public Properties ── */

  /** File attachment to preview */
  @property({type: Object})
  file: FileAttachment | null = null;

  /** Whether the modal is open */
  @property({type: Boolean, reflect: true})
  open: boolean = false;

  /* ── Internal State ── */

  /** Content loading state */
  @state()
  private _contentState: ContentState = 'idle';

  /** Object URL for image preview (needs manual revocation) */
  @state()
  private _objectUrl: string | null = null;

  /** Text content for text file preview */
  @state()
  private _textContent: string = '';

  /** Whether text content was truncated */
  @state()
  private _textTruncated: boolean = false;

  /** Fallback URL (presigned URL when download fails) */
  @state()
  private _fallbackUrl: string | null = null;

  /** Error message */
  @state()
  private _errorMessage: string = '';

  /** AbortController for cancelling downloads */
  private _abortController: AbortController | null = null;

  /** The element that triggered the preview (for focus restoration) */
  private _triggerElement: HTMLElement | null = null;

  /** Bound keydown handler for window-level ESC capture */
  private _boundOnKeydown = (e: KeyboardEvent) => this._handleKeydown(e);

  /* ── Lifecycle ── */

  willUpdate(changed: PropertyValues): void {
    // When file or open changes, load content
    if (changed.has('file') || changed.has('open')) {
      if (this.open && this.file) {
        this._loadContent();
        // Add window-level ESC listener (more reliable than per-element keydown)
        window.addEventListener('keydown', this._boundOnKeydown);
      } else if (!this.open) {
        this._cleanup();
        // Remove window-level ESC listener
        window.removeEventListener('keydown', this._boundOnKeydown);
      }
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._boundOnKeydown);
    this._cleanup();
  }

  /* ── Public Methods ── */

  /**
   * Open the preview modal for a file.
   * @param file - File attachment to preview
   * @param triggerElement - Element that triggered the preview (for focus restoration)
   */
  openPreview(file: FileAttachment, triggerElement?: HTMLElement): void {
    this._triggerElement = triggerElement ?? (document.activeElement as HTMLElement);
    this.file = file;
    this.open = true;

    // Focus close button after render
    this.updateComplete.then(() => {
      const closeBtn = this.shadowRoot?.querySelector('.close-btn') as HTMLElement;
      closeBtn?.focus();
    }).catch(err => {
      log.warn('Failed to focus close button:', err);
    });
  }

  /** Close the preview modal */
  close(): void {
    this.open = false;
    this._cleanup();

    // Restore focus to trigger element
    if (this._triggerElement) {
      this._triggerElement.focus();
      this._triggerElement = null;
    }

    this.dispatchEvent(new CustomEvent('rtc-preview-close', {
      bubbles: true,
      composed: true,
    }));
  }

  /* ── Private Methods ── */

  /** Clean up resources */
  private _cleanup(): void {
    // Abort any in-progress download
    this._abortController?.abort();
    this._abortController = null;

    // Revoke Object URL to prevent memory leak
    this._revokeObjectUrl();

    // Reset state
    this._contentState = 'idle';
    this._textContent = '';
    this._textTruncated = false;
    this._fallbackUrl = null;
    this._errorMessage = '';
  }

  /** Revoke the current Object URL */
  private _revokeObjectUrl(): void {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }

  /** Parse fileid into md5 and ext */
  private _parseFileId(fileid: string): {md5: string; ext: string} {
    const lastDot = fileid.lastIndexOf('.');
    if (lastDot === -1) {
      throw new Error(`Invalid fileid format: ${fileid}`);
    }
    return {
      md5: fileid.slice(0, lastDot),
      ext: fileid.slice(lastDot + 1),
    };
  }

  /** Check if MIME type is image */
  private _isImage(mimetype: string): boolean {
    return mimetype.startsWith('image/');
  }

  /** Check if MIME type is text */
  private _isText(mimetype: string): boolean {
    return mimetype.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/javascript',
       'application/typescript', 'application/x-yaml', 'application/x-sh',
       'application/x-shellscript'].includes(mimetype);
  }

  /** Get filename from FileAttachment */
  private _getFilename(file: FileAttachment): string {
    return (file.extra?.name as string) ?? msg('未命名文件');
  }

  /** Get filesize from FileAttachment */
  private _getFilesize(file: FileAttachment): number {
    return (file.extra?.size as number) ?? 0;
  }

  /** Format file size for display */
  private _formatFilesize(bytes: number): string {
    if (bytes === 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  /** Load preview content based on file type */
  private async _loadContent(): Promise<void> {
    if (!this.file) return;

    // Cancel any previous download
    this._abortController?.abort();
    this._abortController = new AbortController();

    // Reset state
    this._revokeObjectUrl();
    this._contentState = 'loading';
    this._textContent = '';
    this._textTruncated = false;
    this._fallbackUrl = null;
    this._errorMessage = '';

    try {
      const fileStorage = this._fileStorageCtx.fileStorage;
      if (!fileStorage) {
        throw new Error('FileStorage not available');
      }

      const {md5, ext} = this._parseFileId(this.file.fileid);
      const mimetype = this.file.mimetype;

      if (this._isImage(mimetype)) {
        await this._loadImage(fileStorage, md5, ext);
      } else if (this._isText(mimetype)) {
        await this._loadText(fileStorage, md5, ext);
      } else {
        throw new Error(`Unsupported file type: ${mimetype}`);
      }
    } catch (error) {
      // AbortError is expected when user closes quickly
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      log.error('Failed to load preview:', error);
      this._contentState = 'error';
      this._errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  /** Load image preview */
  private async _loadImage(
    fileStorage: NonNullable<FileStorageContextValue['fileStorage']>,
    md5: string,
    ext: string
  ): Promise<void> {
    try {
      // Download file and create Object URL
      const blob = await fileStorage.download(md5, ext, {
        signal: this._abortController?.signal,
      });
      this._objectUrl = URL.createObjectURL(blob);
      this._contentState = 'loaded';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }

      // Fallback: try presigned URL
      log.warn('Download failed, trying presigned URL fallback:', error);
      try {
        this._fallbackUrl = await fileStorage.getPresignedUrl({md5, ext}, 3600);
        this._contentState = 'fallback';
      } catch (fallbackError) {
        log.error('Fallback also failed:', fallbackError);
        throw error; // Throw original error
      }
    }
  }

  /** Load text preview */
  private async _loadText(
    fileStorage: NonNullable<FileStorageContextValue['fileStorage']>,
    md5: string,
    ext: string
  ): Promise<void> {
    const filesize = this._getFilesize(this.file!);

    // Reject files > 10MB
    if (filesize > MAX_TEXT_PREVIEW_SIZE) {
      throw new Error(msg('文件过大，不支持预览'));
    }

    // Download file
    const blob = await fileStorage.download(md5, ext, {
      signal: this._abortController?.signal,
    });

    // Read text content
    const fullText = await blob.text();

    // Check if truncation needed (> 1MB)
    if (fullText.length > TEXT_TRUNCATION_THRESHOLD) {
      const lines = fullText.split('\n');
      if (lines.length > MAX_TEXT_PREVIEW_LINES) {
        this._textContent = lines.slice(0, MAX_TEXT_PREVIEW_LINES).join('\n');
        this._textTruncated = true;
      } else {
        this._textContent = fullText;
      }
    } else {
      this._textContent = fullText;
    }

    this._contentState = 'loaded';
  }

  /* ── Event Handlers ── */

  /** Handle backdrop click */
  private _handleBackdropClick(): void {
    this.close();
  }

  /** Handle content click (stop propagation to prevent closing) */
  private _handleContentClick(e: Event): void {
    e.stopPropagation();
  }

  /** Handle keydown (ESC to close) */
  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  /** Handle close button click */
  private _handleCloseClick(): void {
    this.close();
  }

  /** Handle retry button click */
  private _handleRetryClick(): void {
    this._loadContent();
  }

  /* ── Render Methods ── */

  /** Render modal header */
  private _renderHeader() {
    if (!this.file) return nothing;

    const filename = this._getFilename(this.file);
    const filesize = this._getFilesize(this.file);
    const sizeStr = this._formatFilesize(filesize);

    return html`
      <div class="modal-header" part="header">
        <div class="file-info">
          <div class="file-name" title=${filename}>${filename}</div>
          ${sizeStr ? html`<div class="file-size">${sizeStr}</div>` : nothing}
        </div>
        <button
          class="close-btn"
          aria-label=${msg('关闭')}
          @click=${this._handleCloseClick}
        >✕</button>
      </div>
    `;
  }

  /** Render image preview */
  private _renderImagePreview() {
    const src = this._contentState === 'fallback' ? this._fallbackUrl : this._objectUrl;
    if (!src) return nothing;

    const filename = this.file ? this._getFilename(this.file) : '';

    return html`
      <img
        class="preview-image"
        src=${src}
        alt=${filename}
        @error=${() => {
          this._contentState = 'error';
          this._errorMessage = msg('图片加载失败');
        }}
      />
    `;
  }

  /** Render text preview */
  private _renderTextPreview() {
    return html`
      <pre class="preview-text">${this._textContent}</pre>
      ${this._textTruncated
        ? html`<div class="truncation-notice">${msg('文件过大，仅显示部分内容')}</div>`
        : nothing}
    `;
  }

  /** Render loading state */
  private _renderLoading() {
    return html`
      <div class="preview-loading">
        <span>${msg('加载中...')}</span>
      </div>
    `;
  }

  /** Render error state */
  private _renderError() {
    return html`
      <div class="preview-error">
        <div class="error-icon">⚠️</div>
        <div class="error-message">${this._errorMessage || msg('加载失败')}</div>
        <button class="retry-btn" @click=${this._handleRetryClick}>
          ${msg('点击重试')}
        </button>
      </div>
    `;
  }

  /** Render modal body content */
  private _renderBody() {
    switch (this._contentState) {
      case 'loading':
        return this._renderLoading();
      case 'error':
        return this._renderError();
      case 'loaded':
      case 'fallback':
        if (this.file && this._isImage(this.file.mimetype)) {
          return this._renderImagePreview();
        }
        if (this.file && this._isText(this.file.mimetype)) {
          return this._renderTextPreview();
        }
        return html`<div class="preview-error">${msg('不支持的文件类型')}</div>`;
      default:
        return nothing;
    }
  }

  render() {
    if (!this.open) return nothing;

    const isImageMode = this.file && this._isImage(this.file.mimetype);
    const backdropClass = isImageMode ? 'modal-backdrop image-mode' : 'modal-backdrop';
    const contentClass = isImageMode ? 'modal-content image-mode' : 'modal-content';

    return html`
      <div
        class=${backdropClass}
        part="backdrop"
        role="dialog"
        aria-modal="true"
        aria-label=${msg('文件预览')}
        @click=${this._handleBackdropClick}
      >
        <div
          class=${contentClass}
          part="content"
          @click=${this._handleContentClick}
        >
          ${this._renderHeader()}
          <div class="modal-body" part="body">
            ${this._renderBody()}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-file-preview-modal': RtcFilePreviewModal;
  }
}
