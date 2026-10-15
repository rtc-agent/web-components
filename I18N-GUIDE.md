# i18n/l10n 治理策略

## 架构概览

RTC Agent 的国际化采用双层架构：

### Component Package（Web Components）

- **技术方案**：使用 `@lit/localize` 进行组件级国际化
- **源语言**：zh-CN（中文）
- **目标语言**：en-US（英文）
- **翻译文件**：`xliff/en-US.xlf`（XLIFF 1.2 格式）
- **生成文件**：`src/.generated/locales/en-US.ts`（自动生成，禁止手动修改）
- **Locale 管理**：
  - `sourceLocale`（zh-CN）内联在源代码中，不需要单独的 locale 文件
  - `targetLocales`（en-US）通过 XLIFF 文件管理
- **运行时**：通过 `src/core/i18n.ts` 管理 locale 切换和持久化
- **API 导出**：公共 API 已导出 `switchLocale`、`initLocale`、`getLocale` 等函数

### Admin UI Package（React 应用）

- **技术方案**：使用 Umi Max 内置的 i18n 插件（基于 `react-intl`）
- **支持语言**：9 种语言
  - en-US（英文，基准语言）
  - zh-CN（简体中文）
  - zh-TW（繁体中文）
  - ja-JP（日文）
  - ko-KR（韩文）
  - pt-BR（巴西葡萄牙文）
  - fa-IR（波斯文）
  - id-ID（印尼文）
  - bn-BD（孟加拉文）
- **翻译文件**：`src/locales/{locale}/` 目录
- **基准语言**：en-US（所有其他语言与 en-US 对比检查完整性）

## 工作流程

### Component Package

1. **提取翻译字符串**：
   ```bash
   pnpm --filter @rtc-agent/component run i18n:extract
   ```
   这会扫描源代码中的 `msg()` 和 `str` 标签，更新 `xliff/en-US.xlf` 文件。

2. **翻译 XLIFF 文件**：
   编辑 `xliff/en-US.xlf`，为每个 `<trans-unit>` 添加 `<target>` 标签。

3. **构建 locale 文件**：
   ```bash
   pnpm --filter @rtc-agent/component run i18n:build
   ```
   这会根据 XLIFF 文件生成 `src/.generated/locales/en-US.ts`。

4. **验证**：
   - 构建时会自动编译 locale 文件（`prebuild`、`predev`、`pretypecheck` 钩子）
   - 确保所有 `<trans-unit>` 都有 `<target>` 标签

### Admin UI Package

1. **检查翻译完整性**：
   ```bash
   pnpm --filter admin-ui run i18n:check
   ```
   这会检查所有 9 种语言是否与 en-US 基准一致，报告缺失或多余的 key。

2. **CI 集成**：
   - GitHub Actions CI 流程会自动运行 `i18n:check`
   - 如果翻译不完整，CI 会失败

3. **添加翻译**：
   在 `src/locales/{locale}/` 目录下的相应文件中添加缺失的 key。

## 最佳实践

### Component Package

1. **使用 `msg()` 标记可翻译字符串**：
   ```typescript
   import { msg, str } from '@lit/localize';
   
   const label = msg('保存');
   const greeting = msg(str`你好，${name}！`);
   ```

2. **避免硬编码用户可见文本**：
   所有用户可见的文本都应该使用 `msg()` 包装。

3. **保持 XLIFF 文件同步**：
   每次添加新的 `msg()` 调用后，运行 `i18n:extract` 更新 XLIFF 文件。

4. **及时翻译新字符串**：
   新增的字符串应该立即翻译，避免积累未翻译的条目。

### Admin UI Package

1. **使用 `useIntl()` Hook**：
   ```typescript
   import { useIntl } from '@umijs/max';
   
   const intl = useIntl();
   const label = intl.formatMessage({ id: 'save', defaultMessage: 'Save' });
   ```

2. **保持所有语言同步**：
   添加新的翻译 key 时，必须同时更新所有 9 种语言。

3. **以 en-US 为基准**：
   所有翻译都应该与 en-US 保持一致的 key 结构。

4. **定期运行 `i18n:check`**：
   在提交代码前运行检查，确保翻译完整性。

## 时区处理

日期和时间格式化函数支持可选的时区参数：

```typescript
import { formatDateTime, formatTimeOnly, formatTimestampCompact } from '@rtc-agent/component';

// 使用系统本地时区（默认）
formatDateTime(timestamp);

// 指定时区
formatDateTime(timestamp, false, 'Asia/Shanghai');
formatTimeOnly(timestamp, true, 'America/New_York');
formatTimestampCompact(timestamp, 'Europe/London');
```

**注意**：时区参数使用 IANA 时区名称（如 `Asia/Shanghai`、`America/New_York`）。

## 数字和货币格式化

使用 `Intl.NumberFormat` 进行本地化的数字格式化：

```typescript
import { formatNumber, formatPercentage, formatFileSize } from '@rtc-agent/component';

// 数字格式化（自动使用当前 locale）
formatNumber(1234567.89);  // "1,234,567.89" (en-US)

// 百分比格式化
formatPercentage(0.1234, 2);  // "12.34%"

// 文件大小格式化（使用国际标准单位）
formatFileSize(1536);  // "1.5 KB"
```

**注意**：文件大小单位（B、KB、MB、GB、TB、PB）是技术术语，在大多数语言中保持英文形式，这是行业惯例。

## 相对时间格式化

两个包使用不同的相对时间实现，这是有意为之的设计决策：

### Component Package（Web Components）

**实现**：使用原生 `Intl.RelativeTimeFormat`

**文件**：`packages/component/src/utils/relative-time.ts`

**特点**：

- 零依赖，无需第三方库
- 自动使用当前 locale（通过 `getLocale()` 从 `@lit/localize` 获取）
- 支持所有标准单位（秒、分钟、小时、天、周、月、年）
- 性能优化：缓存 `RelativeTimeFormat` 实例，避免重复分配

**示例**：

```typescript
import { formatRelativeTime } from '@rtc-agent/component';

formatRelativeTime(Date.now() - 300000);  // "5 minutes ago"
formatRelativeTime(Date.now() - 3600000); // "1 hour ago"
```

**设计原因**：

1. **Web Component 不依赖 dayjs**：Component 包是独立的 Web Component 库，不应该强制消费者使用特定的日期库
2. **浏览器原生 API**：`Intl.RelativeTimeFormat` 是现代浏览器标准 API，无需 polyfill
3. **最小化依赖**：保持组件库轻量，避免引入不必要的依赖

### Admin UI Package（React 应用）

**实现**：使用 `dayjs` + `relativeTime` 插件

**文件**：`packages/admin-ui/src/utils/format.ts`

**特点**：

- 基于 dayjs 生态，与项目其他日期处理保持一致
- 支持 9 种语言（与 Admin UI 的 i18n 策略一致）
- 自动映射 Ant Design Pro 的 locale 到 dayjs locale

**示例**：

```typescript
import { formatRelativeTime } from 'admin-ui/utils/format';

formatRelativeTime(Date.now() - 300000);  // "5 minutes ago"
formatRelativeTime('2024-01-01T10:00:00Z'); // "2 hours ago"
```

**设计原因**：

1. **React 应用使用 dayjs**：Admin UI 是 React 应用，已经依赖 dayjs 进行日期处理
2. **生态一致性**：使用 dayjs 保持与项目其他日期操作的一致性
3. **功能丰富**：dayjs 提供更多的日期处理功能，适合复杂的企业应用场景

### 为什么不统一？

**技术原因**：

- Component 包是独立的 Web Component 库，不应强制消费者使用特定日期库
- Admin UI 是 React 应用，已经深度集成 dayjs 生态
- 两个包的 runtime 环境不同（浏览器原生 vs React 应用）

**架构原因**：

- 保持包的独立性，避免不必要的依赖
- 允许各包选择最适合其使用场景的工具
- 符合 monorepo 的最佳实践：包之间松耦合，各自独立

**性能考虑**：

- Component 包使用原生 API，性能更优
- Admin UI 使用 dayjs，功能更丰富，适合复杂场景

## 常见问题

### Q: 为什么 Component Package 只支持 2 种语言？

A: Component Package 是 Web Components 库，主要面向中文和英文用户。如果未来需要支持更多语言，可以通过添加新的 XLIFF 文件来实现。

### Q: 为什么两个包的相对时间实现不同？

A: 这是有意为之的设计决策：

- Component 包使用原生 `Intl.RelativeTimeFormat`，零依赖，适合 Web Component 场景
- Admin UI 使用 `dayjs`，与 React 应用的其他日期处理保持一致
- 两个包的 runtime 环境和依赖策略不同，允许各自选择最适合的工具

### Q: 如何迁移 Component 包的相对时间实现？

A: 不建议迁移。原生 API 性能更好，且无需额外依赖。如果必须使用 dayjs，可以在应用层封装，但不要修改 Component 包的核心实现。

### Q: 为什么 Admin UI 以 en-US 为基准而不是 zh-CN？

A: en-US 是国际通用语言，作为基准可以确保所有语言都有一致的 key 结构，便于翻译和管理。

### Q: 如何处理 RTL（从右到左）语言？

A: Admin UI 支持 fa-IR（波斯文）等 RTL 语言。Umi Max 的 i18n 插件会自动处理 RTL 布局。如果需要自定义样式，可以使用 CSS 逻辑属性（如 `margin-inline-start` 而非 `margin-left`）。

### Q: 翻译缺失时如何 fallback？

A: Component Package 会显示源语言（zh-CN）文本并输出警告。Admin UI 会显示 `defaultMessage` 或 key 本身。

## 工具链

### Component Package

- `@lit/localize`：Lit 官方国际化库
- `@lit/localize-tools`：提供 `lit-localize` CLI 工具
- XLIFF 1.2：翻译交换格式

### Admin UI Package

- `@umijs/max`：内置 i18n 插件
- `react-intl`：React 国际化库
- `check-i18n-coverage.ts`：自定义翻译完整性检查脚本

## 参考资料

- [Lit Localize 文档](https://lit.dev/docs/localize/overview/)
- [Umi Max i18n 文档](https://umijs.org/docs/max/i18n)
- [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)
- [IANA 时区数据库](https://www.iana.org/time-zones)
