import { useEffect, useState } from 'react';
import { getRoleList } from '@/services/role';

/**
 * 管理员角色选项 Hook
 *
 * 加载管理员角色列表，提供 roleMap（id -> displayName）和
 * roleOptions（{ label, value }[]）供下拉选择器使用。
 *
 * 注意：最多加载 1000 个管理员角色，超过部分会被忽略。
 */
export interface UseRoleOptionsResult {
  /** 角色 ID -> 显示名称的映射 */
  roleMap: Map<string, string>;
  /** 适用于 ProFormSelect / Select 的选项列表 */
  roleOptions: Array<{ label: string; value: string }>;
  /** 是否正在加载 */
  loading: boolean;
}

export function useRoleOptions(): UseRoleOptionsResult {
  const [roleMap, setRoleMap] = useState<Map<string, string>>(new Map());
  const [roleOptions, setRoleOptions] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadRoles = async () => {
      setLoading(true);
      try {
        const response = await getRoleList({ page: 1, page_size: 1000 });
        if (cancelled) return;

        const map = new Map<string, string>();
        const options: Array<{ label: string; value: string }> = [];

        response.items.forEach((role) => {
          const displayName = role.display_name || role.name;
          map.set(role.id, displayName);
          options.push({
            label: `${role.display_name} (${role.name})`,
            value: role.id,
          });
        });

        setRoleMap(map);
        setRoleOptions(options);
      } catch (_error) {
        // 忽略错误，角色名称会显示为 role_id
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadRoles();

    return () => {
      cancelled = true;
    };
  }, []);

  return { roleMap, roleOptions, loading };
}
