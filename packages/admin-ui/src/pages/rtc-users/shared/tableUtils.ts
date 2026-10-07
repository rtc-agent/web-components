import dayjs from 'dayjs';

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
