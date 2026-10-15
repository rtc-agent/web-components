import type { MessageInstance } from 'antd/es/message/interface';
import dayjs from 'dayjs';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

/**
 * 禁用未来日期的 DatePicker 配置函数
 * 用于时间范围筛选，禁止选择未来日期
 */
export const disabledFutureDate = (current: dayjs.Dayjs) =>
  current?.isAfter(dayjs(), 'day');

/**
 * 解析 ProTable 的排序参数并转换为 API 需要的格式
 * @param sort - ProTable 的排序对象 { field: 'ascend' | 'descend' }
 * @returns API 需要的排序参数 { sort_by: string, sort_order: 'asc' | 'desc' }
 */
export function parseTableSort(
  sort: Record<string, 'ascend' | 'descend' | null>,
): { sort_by: string; sort_order: 'asc' | 'desc' } | Record<string, never> {
  const sortField = Object.keys(sort || {}).find(
    (key) => sort[key] === 'ascend' || sort[key] === 'descend',
  );
  if (!sortField) return {};
  const sortOrder: 'asc' | 'desc' =
    sort[sortField] === 'ascend' ? 'asc' : 'desc';
  return {
    sort_by: sortField,
    sort_order: sortOrder,
  };
}

/**
 * ProTable request 辅助函数
 *
 * 封装常见的 ProTable request 逻辑，减少重复代码：
 * - 统一的 try-catch 错误处理
 * - 统一的错误消息展示
 * - 统一的返回格式
 *
 * @param fetchFn - 数据获取函数，返回数组或 { items: [], total: number }
 * @param message - antd message 实例，用于展示错误消息
 * @param intl - useIntl 返回的 intl 实例
 * @param errorMessage - 错误消息的默认文本（i18n 对象）
 *
 * @example
 * ```tsx
 * // 简单用法（返回数组）
 * <ProTable
 *   request={createTableRequest(
 *     () => fetchUsers(),
 *     message,
 *     intl,
 *     { id: 'pages.users.loadFailed', defaultMessage: 'Failed to load users' }
 *   )}
 * />
 *
 * // 带分页和排序的用法（返回 { items, total }）
 * <ProTable
 *   request={createTableRequest(
 *     (params, sort) => {
 *       const sortParams = parseTableSort(sort || {});
 *       return fetchUserList({ page: params.current, pageSize: params.pageSize, ...sortParams });
 *     },
 *     message,
 *     intl,
 *     { id: 'pages.users.loadFailed', defaultMessage: 'Failed to load users' }
 *   )}
 * />
 * ```
 */
export function createTableRequest<T>(
  fetchFn: (
    params: { current?: number; pageSize?: number },
    sort?: Record<string, 'ascend' | 'descend' | null>,
  ) => Promise<T[] | { items: T[]; total: number }>,
  message: MessageInstance,
  intl: {
    formatMessage: (descriptor: {
      id: string;
      defaultMessage?: string;
    }) => string;
  },
  errorMessage: { id: string; defaultMessage: string },
) {
  return async (
    params: { current?: number; pageSize?: number },
    sort?: Record<string, 'ascend' | 'descend' | null>,
  ) => {
    try {
      const response = await fetchFn(params, sort);

      // 判断返回值类型：数组或 { items, total }
      if (Array.isArray(response)) {
        return {
          data: response,
          success: true,
          total: response.length,
        };
      }

      return {
        data: response.items,
        total: response.total,
        success: true,
      };
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(error, intl, intl.formatMessage(errorMessage)),
      );
      return {
        data: [],
        total: 0,
        success: false,
      };
    }
  };
}
