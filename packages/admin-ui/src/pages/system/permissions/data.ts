import type { PermissionPolicy } from '@/services/permission';

/** Permission form values */
export type PermissionFormValues = PermissionPolicy;

/** Permission table item */
export interface PermissionTableItem extends PermissionPolicy {
  key: string;
}
