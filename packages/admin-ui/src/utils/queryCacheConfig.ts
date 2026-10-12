/**
 * React Query 缓存时间配置
 *
 * 根据数据特性分类设置 staleTime 和 gcTime：
 * - staleTime: 数据被视为"新鲜"的时间，在此期间不会重新请求
 * - gcTime: 垃圾回收时间，超过此时间后缓存会被清理
 */

/**
 * 用户信息缓存配置
 * 适用于：currentUser 等用户基本信息
 * 特点：变化频率低，可长时间缓存
 */
export const USER_CACHE = {
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 30 * 60 * 1000, // 30 minutes
} as const;

/**
 * 角色/权限列表缓存配置
 * 适用于：角色列表、权限配置等
 * 特点：变化频率低，可长时间缓存
 */
export const ROLE_CACHE = {
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 30 * 60 * 1000, // 30 minutes
} as const;

/**
 * 配置列表缓存配置
 * 适用于：系统配置、选项列表等
 * 特点：中等变化频率
 */
export const CONFIG_CACHE = {
  staleTime: 2 * 60 * 1000, // 2 minutes
  gcTime: 10 * 60 * 1000, // 10 minutes
} as const;

/**
 * 列表数据缓存配置
 * 适用于：普通列表页面数据
 * 特点：数据量较大，适度缓存
 */
export const LIST_CACHE = {
  staleTime: 2 * 60 * 1000, // 2 minutes
  gcTime: 10 * 60 * 1000, // 10 minutes
} as const;

/**
 * Profile 页面缓存配置
 * 适用于：订单详情、业务档案等
 * 特点：只读数据，可长时间缓存
 */
export const PROFILE_CACHE = {
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 30 * 60 * 1000, // 30 minutes
} as const;

/**
 * 搜索数据缓存配置
 * 适用于：搜索结果列表
 * 特点：依赖筛选条件，短期缓存
 */
export const SEARCH_CACHE = {
  staleTime: 30 * 1000, // 30 seconds
  gcTime: 5 * 60 * 1000, // 5 minutes
} as const;

/**
 * 实时数据缓存配置
 * 适用于：日志、实时监控等
 * 特点：变化频繁，最小缓存
 */
export const REALTIME_CACHE = {
  staleTime: 30 * 1000, // 30 seconds
  gcTime: 5 * 60 * 1000, // 5 minutes
} as const;
