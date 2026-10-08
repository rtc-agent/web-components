/**
 * Ensure page API is loaded
 *
 * If the page API is not registered, automatically navigate to the page and wait for page-api-ready event
 *
 * @param pageName - Page name (e.g., 'role', 'admin')
 * @param pagePath - Page path (e.g., '/system/roles')
 * @param queryParams - Optional query params (only used during initial navigation to avoid data flickering)
 */
export async function ensurePageLoaded(
  pageName: keyof NonNullable<typeof window.__pages__>,
  pagePath: string,
  queryParams?: Record<string, string>,
): Promise<void> {
  // Page API already registered — return immediately (no URL comparison)
  if (window.__pages__?.[pageName]) {
    return;
  }

  console.log(
    `[ensurePageLoaded] ${pageName} page not loaded, navigating to ${pagePath}...`,
  );

  // Build URL with query params (avoid data flickering on initial load)
  let fullUrl = pagePath;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const searchParams = new URLSearchParams(queryParams);
    fullUrl = `${pagePath}?${searchParams.toString()}`;
  }

  // Navigate to target page
  const currentPath = window.location.pathname;
  if (currentPath !== pagePath) {
    window.history.pushState({}, '', fullUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  // Wait for page API to be registered
  await waitForPageApi(pageName);
}

/**
 * Wait for page API to be registered
 */
function waitForPageApi(
  pageName: keyof NonNullable<typeof window.__pages__>,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ page: string }>;
      if (customEvent.detail.page === pageName) {
        window.removeEventListener('page-api-ready', handler);
        resolve();
      }
    };
    window.addEventListener('page-api-ready', handler);

    // Timeout protection
    setTimeout(() => {
      window.removeEventListener('page-api-ready', handler);
      console.warn(
        `[ensurePageLoaded] Timeout waiting for ${pageName} page API`,
      );
      resolve();
    }, timeoutMs);
  });
}
