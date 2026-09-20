// Utility functions module
import { createLogger } from '@rtc-agent/client';

const log = createLogger('Utils');

/** How long toast messages remain visible before fading out (ms). */
const TOAST_DISPLAY_DURATION_MS = 3000;

export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    log.debug('showToast called:', message, type);
    const toast = document.getElementById('toast');
    if (!toast) {
        log.error('Toast element not found!');
        return;
    }
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, TOAST_DISPLAY_DURATION_MS);
}
