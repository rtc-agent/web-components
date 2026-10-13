import type { RoleInfo } from '@/services/admin-auth';

/** Admin role form values */
export interface RoleFormValues {
  name: string;
  display_name: string;
  description?: string;
}

/** Admin role table item */
export interface RoleTableItem extends RoleInfo {
  key: string;
}
