/**
 * 管理员角色管理页面的 API 接口
 *
 * 页面组件在挂载时注册这些 API 到 window.__pages__
 * Function handler 通过调用这些 API 来操作 UI
 *
 * 关键原则：
 * - 使用 React 原生方式（actionRef, React Query）
 * - 返回 UI 中显示的数据
 * - 不直接操作 DOM
 */

import type { ActionType } from '@ant-design/pro-components';
import type { RoleInfo } from '@/services/admin-auth';

export interface RolePageAPI {
  /**
   * 读取表格当前显示的数据
   * 从 React Query 缓存中获取，与 UI 显示一致
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    keyword?: string;
  }) => Promise<{
    success: boolean;
    data: RoleInfo[];
    total: number;
  }>;

  /**
   * 刷新表格
   * 调用 actionRef.current?.reload()
   */
  refresh: () => Promise<void>;

  /**
   * 创建管理员角色
   * 触发创建流程（打开弹窗、填充表单、提交）
   */
  create: (data: {
    name: string;
    display_name: string;
    description?: string;
    is_enabled?: boolean;
  }) => Promise<{ success: boolean; id?: string }>;

  /**
   * 更新管理员角色
   * 触发更新流程（打开弹窗、填充数据、提交）
   */
  update: (data: {
    id: string;
    name?: string;
    display_name?: string;
    description?: string;
    is_enabled?: boolean;
  }) => Promise<{ success: boolean }>;

  /**
   * 删除管理员角色
   */
  remove: (
    ids: string[],
  ) => Promise<{ success: boolean; deletedCount?: number }>;
}

// 全局类型声明
declare global {
  interface Window {
    __pages__?: {
      role?: RolePageAPI;
    };
  }
}
