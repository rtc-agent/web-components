# Biome noExplicitAny 规则改进计划

## 当前状态

在根目录 `biome.json` 中，`noExplicitAny` 规则被显式关闭：

```json
{
  "linter": {
    "rules": {
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  }
}
```

## 问题说明

`noExplicitAny` 规则禁止使用显式的 `any` 类型标注。当前全局关闭此规则意味着代码库中存在大量 `any` 类型，这会：

- 削弱 TypeScript 的类型安全性
- 降低 IDE 自动补全的准确性
- 增加运行时类型错误的风险
- 使重构变得更加困难

## 为什么保持现状

立即开启此规则会导致大量编译错误，需要逐步收紧：

1. **历史代码债务**：项目中已存在大量 `any` 类型标注
2. **开发效率**：突然开启会阻断所有开发工作
3. **渐进式改进**：需要时间逐步替换 `any` 为具体类型

## 改进计划

### 阶段 1：统计与分类（当前）

统计代码库中 `any` 的使用情况：

```bash
# 查找所有显式 any
grep -r ": any" packages/*/src --include="*.ts" --include="*.tsx" | wc -l
grep -r "as any" packages/*/src --include="*.ts" --include="*.tsx" | wc -l
```

分类：
- 合理的 `any`（如第三方库类型不完整）
- 可替换为 `unknown` 的 `any`
- 可替换为具体类型的 `any`
- 可替换为泛型的 `any`

### 阶段 2：逐包收紧

按包逐步开启规则，优先级：

1. **protocol** - 纯类型定义，应该最容易
2. **persistence** - 数据层，类型安全性重要
3. **client** - API 层，类型安全性重要
4. **worker** - 业务逻辑，中等难度
5. **component** - Web Components，中等难度
6. **admin-ui** - React 组件，可能最困难

对每个包：
- 修复该包的 `any` 类型
- 在包级 `biome.json`（如果存在）或根级配置中开启规则
- 确保 CI 通过

### 阶段 3：全局开启

当所有包都通过后：
- 移除根级 `biome.json` 中的 `"noExplicitAny": "off"`
- 使用 Biome 推荐的默认值（error 或 warning）

## 替代方案

### 方案 A：使用 biome.jsonc 添加注释

将 `biome.json` 重命名为 `biome.jsonc`，添加注释说明：

```jsonc
{
  "linter": {
    "rules": {
      "suspicious": {
        // TODO: 逐步收紧此规则，最终目标是开启（改为 "error"）
        // 当前因历史代码债务暂时关闭
        // 参见 .claude/notes/biome-no-explicit-any-improvement.md
        "noExplicitAny": "off"
      }
    }
  }
}
```

**注意**：需要验证 Biome 是否支持 `.jsonc` 扩展名。

### 方案 B：使用 overrides 按文件关闭

开启全局规则，但对特定文件/目录关闭：

```json
{
  "linter": {
    "rules": {
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  },
  "overrides": [
    {
      "includes": ["packages/admin-ui/src/legacy/**"],
      "linter": {
        "rules": {
          "suspicious": {
            "noExplicitAny": "off"
          }
        }
      }
    }
  ]
}
```

### 方案 C：使用 @ts-expect-error 注释

对合理的 `any` 使用，使用 `@ts-expect-error` 或类型断言：

```typescript
// ❌ 不推荐
const data: any = await fetchData();

// ✅ 推荐：使用 unknown 并类型守卫
const data: unknown = await fetchData();
if (isValidData(data)) {
  // 使用 data
}

// ✅ 推荐：使用 @ts-expect-error 说明原因
// @ts-expect-error - Third-party library lacks type definitions
const data = untypedLibrary.getData();
```

## 执行建议

1. **短期**（当前迭代）：保持现状，不做任何改动
2. **中期**（1-2 个迭代）：执行阶段 1 统计，制定详细计划
3. **长期**（季度目标）：逐步执行阶段 2，最终达到阶段 3

## 参考资源

- Biome noExplicitAny 规则：https://biomejs.dev/linter/rules/no-explicit-any/
- TypeScript any vs unknown：https://www.typescriptlang.org/docs/handbook/2/functions.html#any-and-unknown
- 类型守卫模式：https://www.typescriptlang.org/docs/handbook/2/narrowing.html
