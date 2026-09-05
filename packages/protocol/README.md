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

### 生成流程

```bash
# 从 docs/protocol/openapi.yaml 生成 models.gen.ts
# （具体脚本见 scripts/）
pnpm --filter @rtc-agent/protocol build
```

## License

[MIT](../../LICENSE)
