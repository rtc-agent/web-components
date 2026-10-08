import type { AgentConfig } from '@rtc-agent/component';
import {
  adminGroup,
  adminRoleGroup,
  auditLogGroup,
  createNavigationGroup,
  permissionGroup,
  roleGroup,
  rtcMessageGroup,
  rtcSessionGroup,
  rtcUserGroup,
  selfAccountGroup,
  serverConfigGroup,
} from './groups';
import type { Permission } from './permission-filter';
import { buildPermissionSet } from './permission-filter';

/**
 * Create all Function Groups with user permissions
 *
 * This function creates groups with permission-aware configurations:
 * - navigation group: filters available pages based on user permissions
 * - role group: static, permission filtering happens at function level
 * - permission group: static, permission filtering happens at function level
 * - user group: static, permission filtering happens at function level
 */
export function createAllGroups(userPermissions: Permission[]) {
  const permissionSet = buildPermissionSet(userPermissions);

  return [
    createNavigationGroup(permissionSet),
    roleGroup,
    permissionGroup,
    auditLogGroup,
    serverConfigGroup,
    adminGroup,
    adminRoleGroup,
    rtcUserGroup,
    rtcSessionGroup,
    rtcMessageGroup,
    selfAccountGroup,
  ];
}

/**
 * Create admin-ui AgentConfig
 *
 * @param filteredGroups - Function Groups after permission filtering
 *
 * Note: Permission filtering is done by rtc-agent-manager.ts before calling this function
 * This function only assembles the final AgentConfig
 */
export function createAdminAgentConfig(
  filteredGroups: Array<{
    name: string;
    description?: string;
    functions: any[];
  }>,
): Partial<AgentConfig> {
  // Output filter results (development environment)
  if (process.env.NODE_ENV === 'development') {
    console.log(
      '[AdminAgentConfig] Filtered groups:',
      filteredGroups.map((g) => `${g.name}(${g.functions.length} functions)`),
    );
  }

  return {
    name: 'AdminUI',
    description: 'AI assistant for the admin dashboard',
    persona:
      "You are the AI assistant of an admin dashboard. You help administrators navigate the system and manage admin roles, permissions, and audit logs through the registered functions. Always act through registered functions. If a function is unavailable, the current admin lacks the required permission — explain this clearly. Be concise, confirm operations with relevant details, and match the user's language.",

    groups: filteredGroups as any, // Type cast: PermissionAwareFunctionDef[] is compatible with AgentFunctionGroup
  };
}
