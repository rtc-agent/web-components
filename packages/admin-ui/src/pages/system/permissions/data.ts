import type { PermissionPolicy } from '@/services/permission';

/** Permission form values */
export interface PermissionFormValues extends PermissionPolicy {}

/** Permission table item */
export interface PermissionTableItem extends PermissionPolicy {
  key: string;
}
