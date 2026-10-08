import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { listServerConfigs } from './list';
import { removeServerConfig } from './remove';
import { updateServerConfig } from './update';

/**
 * Server Config Management Function Group
 *
 * Corresponds to route: /system/configs
 *
 * All functions call the page-exposed React API:
 * - window.__pages__.serverConfig.list()
 * - window.__pages__.serverConfig.update()
 * - window.__pages__.serverConfig.remove()
 *
 * Permission requirements:
 * - list: server_config:read
 * - update: server_config:write
 * - remove: server_config:delete
 */
export const serverConfigGroup = {
  name: 'serverConfig',
  description:
    'Server configuration management module for /system/configs page. Supports viewing, updating, and deleting configs. All operations are reflected in the UI table.',
  functions: [
    listServerConfigs,
    updateServerConfig,
    removeServerConfig,
  ] as PermissionAwareFunctionDef[],
};
