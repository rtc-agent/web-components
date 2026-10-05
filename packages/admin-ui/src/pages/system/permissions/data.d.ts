import type { PermissionPolicy } from '@/services/permission';

/** 权限表单值 */
export interface PermissionFormValues extends PermissionPolicy {}

/** 权限表格项 */
export interface PermissionTableItem extends PermissionPolicy {
  key: string;
}
