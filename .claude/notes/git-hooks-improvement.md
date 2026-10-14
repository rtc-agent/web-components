# Git Hooks 改进建议

## 当前状态

目前仅 `packages/admin-ui` 包配置了 husky Git hooks，根目录缺少统一的 hooks 配置。这导致：

- 其他包（component、protocol、persistence、worker、client）没有 pre-commit 检查
- 代码质量检查（lint、typecheck、test）仅在 admin-ui 开发时自动执行
- 缺乏统一的 commit message 规范强制执行

## 建议方案

将 husky 配置提升到根目录，实现全 workspace 统一的 Git hooks。

### 实施步骤

1. **安装 husky 到根目录**

   ```bash
   cd web-components
   pnpm add -D -w husky
   pnpm exec husky init
   ```

   这会在根目录创建 `.husky/` 目录。

2. **配置 pre-commit hook**

   创建 `.husky/pre-commit`：

   ```bash
   #!/usr/bin/env sh
   
   # 运行 Biome 检查（全 workspace）
   pnpm run check
   
   # 运行类型检查（全 workspace）
   pnpm run typecheck
   
   # 运行测试（全 workspace）
   pnpm run test
   ```

3. **配置 commit-msg hook**

   创建 `.husky/commit-msg`：

   ```bash
   #!/usr/bin/env sh
   
   # 使用 commitlint 验证 commit message
   npx --no -- commitlint edit "$1"
   ```

   需要在根目录安装 commitlint：

   ```bash
   pnpm add -D -w @commitlint/cli @commitlint/config-conventional
   ```

   创建 `commitlint.config.js`：

   ```javascript
   module.exports = {
     extends: ['@commitlint/config-conventional'],
   };
   ```

4. **移除 admin-ui 的独立 husky 配置**

   ```bash
   rm -rf packages/admin-ui/.husky
   ```

   并从 `packages/admin-ui/package.json` 中移除 husky 相关的 prepare 脚本。

5. **更新 package.json**

   在根目录 `package.json` 中添加 prepare 脚本：

   ```json
   {
     "scripts": {
       "prepare": "husky"
     }
   }
   ```

### 替代方案：使用 lint-staged

为了更快的 pre-commit 检查，建议结合使用 lint-staged：

```bash
pnpm add -D -w lint-staged
```

`.husky/pre-commit` 改为：

```bash
pnpm exec lint-staged
```

根目录创建 `lint-staged.config.js`：

```javascript
module.exports = {
  '*.{ts,tsx,js,jsx}': ['biome check --write'],
  '*.json': ['biome format --write'],
};
```

### 注意事项

- 执行此操作前需要通知团队，因为会改变开发工作流
- 需要更新 CI/CD 配置，确保与本地 hooks 一致
- 建议在下一个大版本或迭代周期执行，避免打乱当前开发节奏
- admin-ui 的 `.husky` 目录包含 commit-msg 和 pre-commit，需确认其逻辑已合并到根级配置

### 参考

- Husky 文档：https://typicode.github.io/husky/
- lint-staged 文档：https://github.com/lint-staged/lint-staged
- commitlint 文档：https://commitlint.js.org/
