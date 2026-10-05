/**
 * 确保页面 API 已加载
 *
 * 如果页面 API 未注册，自动导航到页面并等待 page-api-ready 事件
 *
 * @param pageName - 页面名称（如 'role', 'user'）
 * @param pagePath - 页面路径（如 '/system/roles'）
 */
export async function ensurePageLoaded(
  pageName: keyof NonNullable<typeof window.__pages__>,
  pagePath: string,
): Promise<void> {
  // 检查页面 API 是否已注册
  if (window.__pages__?.[pageName]) {
    return;
  }

  console.log(
    `[ensurePageLoaded] ${pageName} page not loaded, navigating to ${pagePath}...`,
  );

  // 导航到页面
  if (window.location.pathname !== pagePath) {
    window.history.pushState({}, '', pagePath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  // 等待页面 API 注册完成
  await new Promise<void>((resolve) => {
    let timeoutId: NodeJS.Timeout;

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ page: string }>;
      if (customEvent.detail.page === pageName) {
        clearTimeout(timeoutId);
        window.removeEventListener('page-api-ready', handler);
        resolve();
      }
    };
    window.addEventListener('page-api-ready', handler);

    // 超时保护：10 秒
    timeoutId = setTimeout(() => {
      window.removeEventListener('page-api-ready', handler);
      console.warn(
        `[ensurePageLoaded] Timeout waiting for ${pageName} page API`,
      );
      resolve();
    }, 10000);
  });
}
