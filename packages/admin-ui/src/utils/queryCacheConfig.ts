/**
 * React Query 缓存时间配置
 *
 * 根据数据特性分类设置 staleTime 和 gcTime：
 * - staleTime: 数据被视为"新鲜"的时间，在此期间不会重新请求
 * - gcTime: 垃圾回收时间，超过此时间后缓存会被清理
 *
 * LOADING STATE MANAGEMENT:
 *
 * 本项目遵循以下 loading 状态管理模式：
 *
 * 1. ProTable 组件：使用内置的 request prop，loading 状态自动管理，无需手动处理
 *    参考：CLAUDE.md > ProTable Loading 状态管理
 *
 * 2. useQuery hook：通过 isLoading / isFetching 属性获取 loading 状态
 *    - isLoading: 首次加载且无缓存数据
 *    - isFetching: 正在请求（包括后台刷新）
 *    示例：const { data, isLoading, isFetching } = useQuery({...})
 *
 * 3. useMutation hook：通过 isPending 属性获取提交状态
 *    示例：const { mutate, isPending } = useMutation({...})
 *
 * 4. 非 ProTable 的手动数据加载：使用 useState 管理 loading 状态
 *    示例：const [loading, setLoading] = useState(false);
 *
 * 注意：避免在 ProTable 场景手动管理 loading 状态（见 CLAUDE.md）
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
 * RTC Agent 配置缓存
 * 适用于：RTC Agent 运行时配置、会话设置等
 * 特点：中等变化频率，用户可能会修改
 */
export const RTC_AGENT_CACHE = {
  staleTime: 2 * 60 * 1000, // 2 minutes
  gcTime: 10 * 60 * 1000, // 10 minutes
} as const;

/**
 * React Query devTools:
 *
 * 开发环境下可启用 React Query DevTools 进行调试：
 *
 * 1. 安装依赖（如未安装）：
 *    pnpm add -D @tanstack/react-query-devtools
 *
 * 2. 在 app.tsx 或 layout 中启用：
 *    import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
 *
 *    export function layout() {
 *      return (
 *        <>
 *          你的布局内容...
 *          {process.env.NODE_ENV === 'development' && (
 *            <ReactQueryDevtools initialIsOpen={false} />
 *          )}
 *         </>
 *      );
 *    }
 *
 * 3. DevTools 功能：
 *    - 查看所有活跃查询及其状态（loading, error, success）
 *    - 手动触发查询失效和重新获取
 *    - 查看查询缓存内容和时间线
 *    - 调整查询参数进行调试
 *
 * 注意：仅在开发环境启用，生产环境不应包含 devTools
 */
