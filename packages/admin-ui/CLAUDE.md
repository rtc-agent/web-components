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