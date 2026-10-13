# CLAUDE.md

## Project

Ant Design Pro — React enterprise boilerplate on Umi Max v4, antd v6, ProComponents v3.

### Workspace Integration

admin-ui 是 pnpm monorepo (`web-components/`) 的一部分，但保留了独立的工具链：

- **包管理器**：使用 `pnpm`（通过 workspace 统一管理）
- **构建工具**：使用 Umi Max 的 `max build`，而非 turbo
- **Lint 工具**：使用 Biome（与 workspace 一致），但配置继承自根级 `biome.json`
- **独立项目**：本质上是 Ant Design Pro 模板项目嵌入 monorepo，有自己的 `.husky`、`.commitlintrc` 等配置

**注意**：虽然 package.json 的 engines 字段曾要求 `package-lock.json`，但实际使用 `pnpm` 作为包管理器（workspace 要求）。

## Commands

**推荐使用 `pnpm`**：

```bash
pnpm start              # 开发服务器（dev+mock）
pnpm run dev            # 开发服务器（no mock）
pnpm run build          # 构建（Umi Max）
pnpm run lint           # 代码检查（Biome + tsc）
pnpm run test           # 运行测试（Vitest）
pnpm run openapi        # 重新生成 src/services/
```

**其他命令**：

```bash
pnpm run simple         # (**不可逆** — 先提交)
pnpm run biome          # 自动修复格式
pnpm run tsc            # 仅类型检查
npx antd lint ./src     # antd 特定检查
npx antd info <Comp>    # 查询 antd 组件 API
```

## Critical Rules

- **Never edit `src/services/ant-design-pro/`** — auto-generated, regenerate with `pnpm run openapi`
- **Biome only** — no ESLint, no Prettier. Both `pnpm run lint` and `npx antd lint ./src` must pass before commit
- **Always `npx antd info <Component>` before writing antd code** — don't guess APIs from memory
- **`pnpm run simple` is irreversible** — always commit/branch first
- **Conventional commits** required (commitlint enforced)
- **TypeScript strict** · **Node ≥ 22** · **pnpm ≥ 8** (workspace 统一要求)
- **`.umi` dir is auto-generated** — delete `src/.umi` and restart if dev server acts up

## Architecture Essentials

**Config**: `config/config.ts` (defineConfig), `config/routes.ts` (declarative routes). Route `name` → `menu.xxx` i18n key; `access` field gates visibility.

**Convention files** (`src/`): `app.tsx` (runtime config + `getInitialState`), `access.ts` (permissions), `global.tsx` (side effects), `loading.tsx`, `typings.d.ts`.

**Auth**: `getInitialState()` → `GET /api/currentUser`; 401 → redirect login. `access.ts`: `canAdmin = currentUser.access === 'admin'`. Mock creds: `admin`/`ant.design` or `user`/`ant.design`.

**State**: `useModel('filename')` for global hooks (`src/models/`). `useModel('@@initialState')` for currentUser/settings. ProTable `request` prop for most data loading. `@tanstack/react-query` for complex server state.

**Styling priority**: Tailwind CSS v4 (layout) → antd-style v4 / `createStyles` (theme tokens) → CSS Modules → Less (legacy only).

**Request**: built-in `request` from `@umijs/max`, configured in `src/requestErrorConfig.ts`. Per-page `service.ts` for non-generated APIs.

**i18n**: 8 locales in `src/locales/`. `useIntl().formatMessage({ id, defaultMessage })`.

**Mock**: `mock/` (global) + `src/pages/**/_mock.ts` (co-located). Express-style handlers.

## Mock 文件使用指南

### 何时使用页面级 `_mock.ts`

- 页面特定的演示数据（如特定格式的列表、详情）
- 后端未实现的 API 端点（**必须**在 `service.ts` 中标注 `MOCK-ONLY`）
- 开发阶段的快速原型（后端接口尚未就绪时）

### 何时使用全局 `mock/` 目录

- 跨页面共享的 mock API（如通用配置、全局状态）
- 认证相关的 mock（登录、注册、当前用户信息等）
- 通用数据格式（如枚举值、常量定义）

### 何时不需要 mock

- 页面使用真实的后端 API 进行开发（后端已实现）
- 已有完整的后端实现且稳定

### Mock-only API 端点规范

当 `service.ts` 调用 mock-only 端点时（即该端点后端尚未实现，仅靠 `_mock.ts` 提供数据）：

1. **在函数 JSDoc 中添加 MOCK-ONLY 警告**：

   ```typescript
   /**
    * Fetch user preferences.
    *
    * MOCK-ONLY: This endpoint is not yet implemented on the backend.
    * Data is provided by `./_mock.ts` for development purposes.
    *
    * TODO: Backend implementation planned for Q2 2026 (see issue #123)
    */
   export async function getUserPreferences() { ... }
   ```

2. **引用对应的 `_mock.ts` 文件**：说明数据来源

3. **添加 TODO 说明后端实现计划**：便于追踪和清理

### 当前 Mock 状态

| 页面 | `service.ts` | `_mock.ts` | 说明 |
| --- | --- | --- | --- |
| `user/register` | YES | YES | 注册接口 mock |
| `account/settings` | YES | YES | 账户设置 mock |
| `account/center` | YES | YES | 账户中心 mock |
| `chatbot` | YES | NO | 使用真实后端 API |
| `rtc-users/management` | YES | NO | 使用真实后端 API |
| `rtc-users/sessions` | YES | NO | 使用真实后端 API |
| `rtc-users/messages` | YES | NO | 使用真实后端 API |

**Cloudflare Worker**: `cloudflare-worker/` — separate Hono app, own `package.json`, not an npm workspace.

## AI Skills

This project ships with two built-in Claude Code Skills (`.claude/skills/`). If you already have these skills in your project, no installation is needed — just run them directly. To update to the latest skill definitions, run `npx skills add ant-design/ant-design-pro`.

### `/pro-upgrade` — Project Upgrade

Run `/pro-upgrade` in Claude Code to auto-upgrade the project to the latest Ant Design Pro version. It diffs the latest template against this project and merges framework changes while preserving business code. Works for any version gap (v5→v6, v6.x→latest, etc.).

### `/antd` — Ant Design CLI

Run `/antd` in Claude Code for any antd-related work. It provides access to `@ant-design/cli` with offline metadata for antd v3/v4/v5/v6. Key commands:

- `npx antd info <Component>` — look up props/API before writing code (mandatory)
- `npx antd lint ./src` — check for deprecated or problematic usage (must pass before commit)
- `npx antd demo <Component> <demo>` — get working code examples
- `npx antd migrate <from> <to>` — migration checklist between major versions

## Page Co-location

Each page dir: `index.tsx`, optional `service.ts`, `_mock.ts`, `data.d.ts`, style files. Keep page-specific code with the page.

## Service 文件组织规范

API 服务文件按以下规则组织：

- **页面独有 API**: 放在页面目录下的 `service.ts`（如 `src/pages/rtc-users/management/service.ts`）
- **跨页面共享 API**: 放在 `src/services/` 目录（如 `src/services/audit-log.ts`）
- **自动生成的 API**: 放在 `src/services/ant-design-pro/`（通过 `pnpm run openapi` 生成，**禁止手动修改**）
- **Page API 注册**: 每个页面可在 `index.tsx` 中注册全局 Page API（`window.__pages__`），供外部系统调用

**判断标准**：如果 API 只在一个页面使用，放在页面目录；如果被多个页面引用，提升到 `src/services/`。

## ProTable Loading 状态管理

ProTable 的 `request` prop 会自动管理 loading 状态，**无需手动维护**：

```tsx
// ✅ 正确：依赖 ProTable 内置 loading
<ProTable
  request={async (params, sort) => {
    const response = await fetchData(params);
    return { data: response.items, total: response.total, success: true };
  }}
/>

// ❌ 错误：手动管理 loading（冗余且不一致）
const [loading, setLoading] = useState(false);
<ProTable
  loading={loading}
  request={async (params, sort) => {
    setLoading(true);
    try {
      const response = await fetchData(params);
      return { data: response.items, total: response.total, success: true };
    } finally {
      setLoading(false);
    }
  }}
/>
```

**例外**：非 ProTable 的数据加载（如 Drawer、Modal 中的自定义列表）仍需手动管理 loading 状态。

## 状态管理规范

### 全局状态（useModel('@@initialState')）

- **用途**：用户信息、主题设置、权限数据
- **更新时机**：登录后、权限变更后、主题切换时
- **注意事项**：避免存储频繁变化的数据
- **示例**：`currentUser`、`settings`、`theme`

### 服务端状态（useQuery）

- **用途**：API 数据缓存（列表、详情、统计数据）
- **缓存策略**：根据数据变化频率选择 `USER_CACHE` / `CONFIG_CACHE` / `LIST_CACHE`
- **Query Keys**：统一使用 `src/utils/queryKeys.ts` 中定义的 keys
- **Mutation**：成功后必须 invalidate 相关 queries 或使用 `actionRef.reload()`

- **示例**：

  ```tsx
  // 使用 useQuery 获取数据
  const { data } = useQuery({
    queryKey: queryKeys.currentUser.settings(),
    queryFn: () => queryCurrent(),
    staleTime: USER_CACHE.staleTime,
  });

  // Mutation 后 invalidate
  const { mutate } = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.configs.all });
    },
  });
  ```

### 本地状态（useState）

- **用途**：UI 状态（modal 开关、表单数据、展开/收起状态）
- **原则**：最小化 useState 使用，优先使用派生状态
- **复杂状态**：使用 useReducer 替代多个 useState
- **示例**：`modalVisible`、`formData`、`expandedKeys`

### URL 状态（useSearchParams）

- **用途**：表格筛选、分页、排序参数
- **优点**：可分享、可刷新、可回退
- **工具**：使用 `useTableSearchParams` hook 简化操作
- **示例**：`?status=active&page=1&sort=created_at`

### 响应式状态

- **工具**：使用 `useIsMobile()` hook 统一判断移动端
- **Modal 宽度**：使用 `useResponsiveModalWidth()` hook
- **断点**：`< 768px` 为移动端

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---