import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import type { PageDefinition } from './page-registry';
import { extractPageName, formatPageListForDescription } from './page-registry';

/**
 * Navigate to a specified page
 *
 * No permission required, available to all administrators
 *
 * Implementation:
 * - Uses window.history.pushState for navigation
 * - Listens for page-api-ready event to ensure page is loaded
 * - Returns after page API is registered, so subsequent functions can call it
 */
export const createGotoFunction = (
  availablePages: PageDefinition[],
): PermissionAwareFunctionDef => ({
  name: 'goto',
  description: `Navigate to a specified page and wait until the page API is registered before returning.

Available pages:
${formatPageListForDescription(availablePages)}`,

  // No permission required
  requiredPermissions: [],

  zodSchema: z.object({
    path: withMeta(z.string(), { example: '/system/roles' }).describe(
      'Target page path to navigate to. Must be a valid route in the admin system (e.g., /system/users, /system/roles, /system/permissions, /system/audit-logs, /system/configs).',
    ),
    query: withMeta(z.record(z.string()), { example: { keyword: 'admin' } })
      .optional()
      .describe(
        'Query parameters to append to URL (e.g., { keyword: "admin" } for search filters).',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        path: z.string().describe('Current page path'),
        title: z.string().describe('Page title'),
      })
      .describe('Navigation result'),
  },

  handler: async (params) => {
    const { path, query } = params as {
      path: string;
      query?: Record<string, string>;
    };

    // Build full URL with query params
    let fullUrl = path;
    if (query && Object.keys(query).length > 0) {
      const searchParams = new URLSearchParams(query);
      fullUrl = `${path}?${searchParams.toString()}`;
    }

    // Extract page name (infer page API key from path)
    const pageName = extractPageName(path);

    // 1. Navigate to the new page (with query params if any)
    const currentUrl = window.location.pathname + window.location.search;
    if (currentUrl !== fullUrl) {
      window.history.pushState({}, '', fullUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }

    // 2. Wait for page API to be registered (deterministic wait, no setTimeout)
    if (!window.__pages__?.[pageName as keyof typeof window.__pages__]) {
      await new Promise<void>((resolve) => {
        const handler = (e: Event) => {
          const customEvent = e as CustomEvent<{ page: string }>;
          if (customEvent.detail.page === pageName) {
            window.removeEventListener('page-api-ready', handler);
            resolve();
          }
        };
        window.addEventListener('page-api-ready', handler);

        // Timeout protection: auto-resolve after 10 seconds
        setTimeout(() => {
          window.removeEventListener('page-api-ready', handler);
          console.warn(
            `[navigation.goto] Timeout waiting for page API: ${pageName}`,
          );
          resolve();
        }, 10000);
      });
    }

    // 3. Page API is now registered, subsequent functions can call it directly

    return {
      success: true,
      path: fullUrl,
      title: document.title,
    };
  },

  hooks: {
    onStart: (params) => {
      console.log(
        `[navigation.goto] Navigating to ${(params as any)?.path}...`,
      );
    },
    onSuccess: (result) => {
      console.log(
        `[navigation.goto] Navigation successful: ${(result as any).path}`,
      );
    },
    onError: (error) => {
      console.error('[navigation.goto] Navigation failed:', error.message);
    },
  },
});
