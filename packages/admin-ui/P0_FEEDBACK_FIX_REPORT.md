# P0 修复报告：静态 Feedback API 主题适配失效

## 问题描述
使用 `message.*` / `notification.*` 静态方法在暗色主题下会显示白色背景，原因是静态方法无法消费 ConfigProvider 上下文。

## 修复方案

### 架构设计
采用三层解决方案：
1. **组件层**：使用 `App.useApp()` hook 获取上下文感知的 feedback API
2. **非组件层**：创建全局实例注册表，通过 `getGlobalFeedbackInstances()` 访问
3. **根容器**：在 `rootContainer` 中添加 `<App>` 包装器并提供 `MessageThemeConfig` 组件

### 修改的文件清单

#### 核心基础设施（3 个文件）
1. **src/app.tsx**
   - ✅ 在 `rootContainer` 中添加 `<App>` 包装器
   - ✅ 创建 `MessageThemeConfig` 组件注册全局实例
   - ✅ 替换 `onPageChange` 中的静态 `message.warning` 调用
   - 导入变更：添加 `App` 组件导入，移除 `message` 静态导入

2. **src/utils/globalFeedback.ts**（新建）
   - ✅ 创建全局 feedback 实例注册表
   - ✅ 提供 `setGlobalFeedbackInstances()` 注册函数
   - ✅ 提供 `getGlobalFeedbackInstances()` 获取函数
   - ✅ 支持早期初始化的 fallback 机制
   - ✅ 完整的 JSDoc 文档和类型定义

3. **src/requestErrorConfig.ts**
   - ✅ 移除 `message` 和 `notification` 静态导入
   - ✅ 替换 11 处静态 API 调用为 `getGlobalFeedbackInstances()`
   - 影响范围：
     - `refreshTokenAndUpdatePermissions` 中的权限同步失败警告
     - `errorHandler` 中的所有错误提示（6 处）
     - 响应拦截器中的 session 过期提示（2 处）
     - 响应拦截器中的通用错误提示（1 处）
     - 拦截器错误处理的错误提示（1 处）

#### 组件更新（2 个文件）
4. **src/pages/user/register/index.tsx**
   - ✅ 添加 `App` 组件导入
   - ✅ 移除 `message` 静态导入
   - ✅ 在 `Register` 组件中使用 `App.useApp()` hook

5. **src/hooks/usePermissionRefresh.ts**
   - ✅ 添加 `App` 组件导入
   - ✅ 使用 `App.useApp()` hook 获取 `message` 实例
   - ✅ 移除动态 `import('antd')` 模式
   - ✅ 修复预存的 `Math.pow` → `**` 操作符问题（Biome lint）

#### 测试更新（1 个文件）
6. **src/requestErrorConfig.test.ts**
   - ✅ 移除未使用的 `message` 和 `notification` 静态导入
   - ✅ 创建 mock 实例 `mockMessage` 和 `mockNotification`
   - ✅ 更新 `@/utils/globalFeedback` 的 mock 实现
   - ✅ 替换所有断言使用 mock 实例
   - ✅ 所有 22 个测试通过

#### 无需修改的文件
- **src/utils/tableUtils.ts** - 已使用依赖注入模式（message 作为参数传入）
- **19 个组件文件** - 已正确使用 `App.useApp()`

## 验证结果

### 测试
```bash
$ pnpm run test
✓ 9 个测试文件
✓ 102 个测试用例全部通过
✓ 包括 22 个 requestErrorConfig 测试
```

### 代码质量
```bash
$ pnpm exec biome lint <modified files>
✓ 所有修改的文件通过 Biome lint
✓ 无警告无错误
```

### TypeScript 编译
```bash
$ pnpm run tsc
✓ 无新增编译错误
✓ 预存的错误与本次修改无关
```

## 技术亮点

### 1. 向后兼容
- 全局注册表提供 fallback 机制，确保早期初始化时仍能显示反馈
- 不会影响现有代码的正常运行

### 2. 类型安全
- 使用 TypeScript 接口定义 feedback 实例类型
- 导入 `MessageInstance` 和 `NotificationInstance` 类型
- 完整的类型检查和智能提示

### 3. 架构清晰
- 组件代码：使用 `App.useApp()` hook
- 非组件代码：使用 `getGlobalFeedbackInstances()`
- 职责分离，易于理解和维护

### 4. 文档完善
- JSDoc 注释详细说明每个函数的用途
- 使用示例清晰明了
- 注意事项和 edge case 说明完整

## 暗色主题适配效果

### 修复前
- `message.success()` → 白色背景
- `message.error()` → 白色背景
- `notification.open()` → 白色背景
- 在暗色主题下视觉不协调

### 修复后
- 所有 feedback API 自动消费 ConfigProvider 主题上下文
- 暗色主题下显示深色背景
- 亮色主题下显示浅色背景
- 视觉体验统一协调

## 影响范围统计

| 类别 | 数量 | 说明 |
|------|------|------|
| 修改的文件 | 6 | 3 个核心 + 2 个组件 + 1 个测试 |
| 新增的文件 | 1 | globalFeedback.ts |
| 替换的 API 调用 | 15+ | message.* 和 notification.* |
| 影响的函数 | 5 | errorHandler, responseInterceptors 等 |
| 测试用例 | 22 | 全部通过 |
| 总测试用例 | 102 | 全部通过 |

## 后续建议

### 代码审查重点
1. `src/utils/globalFeedback.ts` - 核心注册表实现
2. `src/app.tsx` - MessageThemeConfig 组件
3. `src/requestErrorConfig.ts` - 11 处 API 调用替换

### 潜在的优化方向
1. 考虑将 `getGlobalFeedbackInstances()` 的 fallback 改为可选的警告级别
2. 考虑添加单元测试覆盖 `globalFeedback.ts` 模块
3. 考虑在 Storybook 中添加暗色主题的 feedback 示例

## 总结

本次修复通过引入全局 feedback 实例注册表，成功解决了 Ant Design v5+ 静态 feedback API 无法消费主题上下文的问题。修复方案架构清晰、向后兼容、类型安全，所有测试通过，代码质量良好。

暗色主题下的 feedback UI 现在能够正确显示深色背景，视觉体验统一协调。
