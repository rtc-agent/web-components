import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getRoleList } from '@/services/role';
import { ROLE_CACHE } from '@/utils/queryCacheConfig';
import { queryKeys } from '@/utils/queryKeys';

/**
 * 管理员角色选项 Hook
 *
 * 加载管理员角色列表，提供 roleMap（id -> displayName）和
 * roleOptions（{ label, value }[]）供下拉选择器使用。
 *
 * 注意：最多加载 1000 个管理员角色，超过部分会被忽略。
 * 使用 react-query 缓存数据，避免重复请求。
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
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.roleList.all,
    queryFn: async () => {
      try {
        const response = await getRoleList({ page: 1, page_size: 1000 });
        return response.items;
      } catch (error) {
        console.warn('[useRoleOptions] Failed to fetch role list:', error);
        return [];
      }
    },
    staleTime: ROLE_CACHE.staleTime, // 5 minutes
    gcTime: ROLE_CACHE.gcTime, // 30 minutes
  });

  const { roleMap, roleOptions } = useMemo(() => {
    const map = new Map<string, string>();
    const options: Array<{ label: string; value: string }> = [];

    data?.forEach((role) => {
      const displayName = role.display_name || role.name;
      map.set(role.id, displayName);
      options.push({
        label: `${role.display_name} (${role.name})`,
        value: role.id,
      });
    });

    return { roleMap: map, roleOptions: options };
  }, [data]);

  return { roleMap, roleOptions, loading: isLoading };
}
