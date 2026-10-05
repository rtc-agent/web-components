import type { RoleInfo } from '@/services/admin-auth';

/** 角色表单值 */
export interface RoleFormValues {
  name: string;
  display_name: string;
  description?: string;
}

/** 角色表格项 */
export interface RoleTableItem extends RoleInfo {
  key: string;
}
