# @rtc-agent/protocol

RTC Agent 协议类型定义（TypeScript 侧）。由 OpenAPI schema 通过 `openapi-typescript` 生成，并提供域模型别名。

## 功能

- OpenAPI 生成的 paths / components / operations 类型
- 域模型别名（`Session` / `Message` / `Turn` / `Rtc` / ...）
- RPC 方法名常量

## 导出

```ts
import type { Session, Message, Turn, Rtc, UUID } from '@rtc-agent/protocol';
import { RpcMethod } from '@rtc-agent/protocol';

const method = RpcMethod.SessionList; // 'v1.session.list'
```

### 枚举使用

枚举以 `const` + `type` 对形式导出（TypeScript const enum 模式）：

```ts
import { SyncStatus } from '@rtc-agent/protocol';
import type { SyncStatus as SyncStatusType } from '@rtc-agent/protocol';

// 使用值
const status: SyncStatusType = SyncStatus.Syncing;

// 类型守卫搭配使用
import { isValidMessage } from '@rtc-agent/protocol';

if (isValidMessage(data)) {
  // data is narrowed to Message
  console.log(data.role, data.streaming_status);
}
```

### ContentData 类型安全

`ContentData.data` 字段为 `unknown` 类型（由 OpenAPI oneOf 生成），应使用类型守卫而非手动断言：

```ts
import type { ContentData } from '@rtc-agent/protocol';
import {
  isStringContentData,
  isToolCallInputContent,
  isErrorContentData,
} from '@rtc-agent/protocol';

function extractText(content: ContentData): string {
  if (isStringContentData(content)) {
    return content.data; // narrowed to string
  }
  if (isErrorContentData(content)) {
    return content.data.title; // narrowed to ErrorContent
  }
  return '';
}
```

### Type Export Conventions

To maintain consistency and type safety across the codebase, follow these conventions when exporting types:

1. **Interfaces** — Always use `export interface` for object shapes that may be extended:

   ```ts
   export interface Session {
     id: string;
     title: string;
     // ...
   }
   ```

2. **Type Aliases** — Use `export type` for unions, intersections, or computed types:

   ```ts
   export type SyncStatus = 'syncing' | 'synced' | 'error';
   export type EntityId = string;
   ```

3. **Enum Constants** — Use `export const` + `export type` pair (const enum pattern):

   ```ts
   export const SyncStatus = {
     Syncing: 'syncing',
     Synced: 'synced',
     Error: 'error',
   } as const;
   export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];
   ```

4. **Avoid `export *`** — Do not use wildcard re-exports in non-barrel files. Explicitly enumerate exports to prevent unintended exposure and improve tree-shaking:

   ```ts
   // Good (non-barrel file)
   export { Session } from './session';
   export type { Message } from './message';

   // Avoid (non-barrel file)
   export * from './session';
   ```

   **Exception**: Barrel files (e.g., `index.ts`) may use `export *` to simplify re-exports from multiple modules. This is acceptable because:
   - Barrel files are aggregation points, not API design surfaces
   - Explicit enumeration in barrel files adds maintenance overhead without meaningful safety gains
   - The source modules remain the single source of truth for what's exported

   ```ts
   // Acceptable in barrel files (index.ts)
   export * from './models.js';
   export * from './extensions.js';
   export * from './enums.js';
   ```

5. **Type-only imports** — Use `import type` for type-only imports to improve build performance:

   ```ts
   import type { Session, Message } from '@rtc-agent/protocol';
   ```

### 生成流程

```bash
# 从 docs/protocol/api.yaml 生成 models.gen.ts
pnpm --filter @rtc-agent/protocol generate:openapi

# 然后构建
pnpm --filter @rtc-agent/protocol build
```

## License

[MIT](../../LICENSE)
