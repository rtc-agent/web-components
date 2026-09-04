/**
 * Clipboard 工具函数
 *
 * 提供跨浏览器兼容的剪贴板复制功能。
 * 优先使用 navigator.clipboard API，降级到 execCommand。
 */

/**
 * 复制文本到剪贴板
 *
 * @param text 要复制的文本
 * @returns 是否成功
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 优先使用现代 Clipboard API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级到 execCommand
    }
  }

  // Fallback: 使用 execCommand（同步，旧浏览器兼容）
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
