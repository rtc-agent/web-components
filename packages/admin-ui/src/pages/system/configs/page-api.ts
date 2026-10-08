/**
 * Server Config Page API Interface
 *
 * Page component registers these APIs on mount.
 * Function handlers call these APIs to operate the UI.
 *
 * Key principles:
 * - Uses React native patterns (actionRef, service functions)
 * - Returns data matching UI display
 * - Does not directly manipulate DOM
 */

import type { ServerConfigItem } from '@/services/serverConfig';

export interface ServerConfigPageAPI {
  /**
   * Read table data (matches UI display).
   * Supports optional pagination and category filter.
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    category?: string;
  }) => Promise<{
    success: boolean;
    data: ServerConfigItem[];
    total: number;
  }>;

  /**
   * Refresh table.
   * Calls actionRef.current?.reload().
   */
  refresh: () => Promise<void>;

  /**
   * Update a server config value.
   * Calls PUT /api/configs/:key then reloads the table.
   */
  update: (data: {
    key: string;
    value: unknown;
    version?: number;
    change_note?: string;
  }) => Promise<{ success: boolean }>;

  /**
   * Delete a server config (reset to YAML default).
   * Calls DELETE /api/configs/:key then reloads the table.
   */
  remove: (data: {
    key: string;
    version: number;
  }) => Promise<{ success: boolean }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    serverConfig?: ServerConfigPageAPI;
  }
}
