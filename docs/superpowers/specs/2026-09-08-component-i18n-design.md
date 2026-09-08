# web-components/packages/component 国际化设计文档

**日期**: 2026-09-08  
**方案**: @lit/localize (Lit 官方)  
**状态**: Draft

---

## 1. 背景与目标

### 1.1 现状

- `web-components/packages/component` 包含 41 个 Lit 组件，15 个 contexts，19 个 controllers
- 至少 29 个文件存在硬编码中文文本（UI 标签、按钮、状态消息、错误提示、ARIA 标签等）
- 无系统化的国际化基础设施
- 唯一的 locale 感知代码：`relative-time.ts`（使用 `Intl.RelativeTimeFormat`，支持 zh-CN/en-US）

### 1.2 目标

1. 引入 `@lit/localize` 运行时模式，支持多语言
2. 源语言为中文（`zh-CN`），目标语言先支持英文（`en-US`），后续可扩展
3. 与现有 Context + Controller 架构融合
4. 支持运行时语言切换，无需刷新页面
5. 语言偏好持久化到 localStorage

---

## 2. 技术选型

### 2.1 选择 @lit/localize 的理由

| 方案 | 特点 | 选择 |
| --- | --- | --- |
| **@lit/localize** | Lit 官方维护，构建时提取，类型安全，工具链完善 | ✅ |
| @shoelace-style/localize | 基于 Reactive Controller，轻量 | - |
| lit-i18n | 基于 i18next，功能全 | - |

### 2.2 运行时模式 vs 转换模式

选择 **Runtime 模式**：

- 单构建产物，按需加载语言包
- 运行时切换语言无需刷新页面
- 适合 Web Component 库的发布模式

Transform 模式需要为每种语言生成独立构建，增加发布复杂度。

---

## 3. 架构设计

### 3.1 整体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                    App Entry (main.ts)                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  configureLocalization({                            │    │
│  │    sourceLocale: 'zh-CN',                           │    │
│  │    targetLocales: ['en-US'],                        │    │
│  │    loadLocale: (locale) => import(`./locales/...`)  │    │
│  │  })                                                 │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Locale Context                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  localeContext: Context<{ locale, setLocale, ... }> │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Components (@localized())                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ rtc-login   │  │ rtc-settings│  │ rtc-...     │        │
│  │ msg('登录')  │  │ msg('设置')  │  │ msg(...)    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 新增文件结构

```text
web-components/packages/component/
├── src/
│   ├── locales/                    # 语言包目录（手动维护）
│   │   └── en-US.ts               # 英文翻译
│   ├── .generated/                 # 构建产物（gitignore，勿手动编辑）
│   │   ├── locale-codes.ts        # 自动生成的语言代码常量
│   │   └── locales/               # 运行时加载的模块
│   ├── core/
│   │   ├── i18n.ts                # 配置初始化 + locale context
│   │   └── locale-controller.ts   # LocaleController（§4.6）
│   └── ...
├── xliff/                          # XLIFF 翻译文件
│   └── en-US.xlf
├── lit-localize.json              # 工具配置
└── package.json
```

---

## 4. 详细设计

### 4.1 i18n 核心模块

**文件**: `src/core/i18n.ts`

```typescript
import { configureLocalization } from '@lit/localize';
import { createContext } from '@lit/context';
import type { LocaleModule } from '@lit/localize';

// 1. 语言代码
export const sourceLocale = 'zh-CN' as const;
export const targetLocales = ['en-US'] as const;
export type SupportedLocale = typeof targetLocales[number] | typeof sourceLocale;

// 2. 动态导入语言包
const localeModules: Record<string, () => Promise<LocaleModule>> = {
  'en-US': () => import('../locales/en-US.js'),
};

// 3. 配置 localize 运行时
export const { getLocale, setLocale: _setLocale } = configureLocalization({
  sourceLocale,
  targetLocales,
  loadLocale: async (locale) => {
    const loader = localeModules[locale];
    if (!loader) {
      const available = Object.keys(localeModules).join(', ');
      throw new Error(
        `[i18n] Unknown locale: "${locale}". Available: ${available}`
      );
    }
    try {
      return await loader();
    } catch (err) {
      throw new Error(
        `[i18n] Failed to load locale "${locale}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
});

// 4. Locale Context
export interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  locales: readonly SupportedLocale[];
}

export const localeContext = createContext<LocaleContextValue>(Symbol('locale'));

// 4. 类型守卫：编译期保证类型安全
const validLocales: readonly string[] = [sourceLocale, ...targetLocales];

function isValidLocale(value: string): value is SupportedLocale {
  return validLocales.includes(value);
}

// 5. 持久化
const STORAGE_KEY = 'rtc-agent-locale';

function getInitialLocale(): SupportedLocale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && isValidLocale(saved)) {
    return saved;
  }
  const browserLang = navigator.language;
  if (isValidLocale(browserLang)) {
    return browserLang;
  }
  return sourceLocale;
}

export async function initLocale(): Promise<void> {
  const initial = getInitialLocale();
  if (initial !== sourceLocale) {
    await _setLocale(initial);
  }
  // 同步文档 lang 属性，确保屏幕阅读器使用正确发音规则
  document.documentElement.lang = initial;
}

export function persistLocale(locale: SupportedLocale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

/**
 * 切换语言并同步所有相关状态
 * 组件中应调用此函数而非直接调用 _setLocale
 */
export async function switchLocale(locale: SupportedLocale): Promise<void> {
  await _setLocale(locale);
  persistLocale(locale);
  document.documentElement.lang = locale;
}
```

### 4.2 组件改造模式

**改造前**:

```typescript
@customElement('rtc-settings-panel')
export class RtcSettingsPanel extends LitElement {
  render() {
    return html`
      <h2>设置</h2>
      <button aria-label="关闭设置">...</button>
    `;
  }
}
```

**改造后**:

```typescript
import { msg, localized } from '@lit/localize';
import { consume } from '@lit/context';
import { localeContext, type LocaleContextValue, sourceLocale, targetLocales } from '../../core/i18n.js';

@localized()
@customElement('rtc-settings-panel')
export class RtcSettingsPanel extends LitElement {
  @consume({ context: localeContext, subscribe: true })
  @state()
  private _localeCtx: LocaleContextValue = {
    // 提供默认值，避免组件未包裹在 context provider 中时崩溃
    locale: sourceLocale,
    setLocale: async () => {
      console.warn('[rtc-settings-panel] Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  render() {
    return html`
      <h2>${msg('设置')}</h2>
      <button aria-label=${msg('关闭设置')}>...</button>
    `;
  }
}
```

**或者使用 LocaleController 简化（推荐）**:

```typescript
import { LocaleController } from '../../core/locale-controller.js';

@localized()
@customElement('rtc-settings-panel')
export class RtcSettingsPanel extends LitElement {
  private _locale = new LocaleController(this);

  render() {
    return html`
      <h2>${msg('设置')}</h2>
      <button aria-label=${msg('关闭设置')}>...</button>
    `;
  }
}
```

**改造规则**:

| 场景 | 处理方式 |
| --- | --- |
| 纯文本 `设置` | `msg('设置')` |
| 带变量 `已保存 ${count} 个文件` | `msg(str\`已保存 ${count} 个文件\`)` |
| 带 HTML `点击 <a>这里</a>` | `msg(html\`点击 <a>这里</a>\`)` |
| aria-label | `aria-label=${msg('关闭')}` |
| title/tooltip | `title=${msg('保存 (Ctrl+S)')}` |

### 4.3 工具链配置

**文件**: `lit-localize.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/lit/lit/main/packages/localize-tools/config.schema.json",
  "sourceLocale": "zh-CN",
  "targetLocales": ["en-US"],
  "tsConfig": "./tsconfig.json",
  "output": {
    "mode": "runtime",
    "outputDir": "./src/.generated/locales",
    "localeCodesModule": "./src/.generated/locale-codes.ts"
  },
  "interchange": {
    "format": "xliff",
    "xliffDir": "./xliff/"
  }
}
```

**npm scripts**:

```json
{
  "scripts": {
    "i18n:extract": "lit-localize extract",
    "i18n:build": "lit-localize build",
    "i18n:lint": "lit-localize lint"
  }
}
```

> `i18n:lint` 检查源文件中是否有遗漏的硬编码文本，建议加入 CI 流程。

### 4.4 工作流

```text
开发者写代码                翻译流程                    构建
─────────────           ──────────                ─────────
msg('设置')              
      │                  
      ▼                  
lit-localize extract     
      │                  
      ▼                  
xliff/en-US.xlf ──────►  翻译人员填写 ──────► xliff/en-US.xlf
                          (或翻译工具)          (翻译完成)
                                                    │
                                                    ▼
                                            lit-localize build
                                                    │
                                                    ▼
                                            src/generated/locales/en-US.ts
```

### 4.5 语言切换 UI

**设置面板中的语言选择器**:

```typescript
import { consume } from '@lit/context';
import { localeContext, type LocaleContextValue, type SupportedLocale, switchLocale } from '../../core/i18n.js';

render() {
  return html`
    <div class="setting-group">
      <label>${msg('语言')}</label>
      <select @change=${this._onLocaleChange}>
        <option value="zh-CN" ?selected=${this._localeCtx.locale === 'zh-CN'}>简体中文</option>
        <option value="en-US" ?selected=${this._localeCtx.locale === 'en-US'}>English</option>
      </select>
    </div>
  `;
}

private async _onLocaleChange(e: Event) {
  const locale = (e.target as HTMLSelectElement).value as SupportedLocale;
  await switchLocale(locale);
}
```

**初始化时机**:

| 场景 | 初始化位置 | 说明 |
| --- | --- | --- |
| 独立应用 | `main.ts` 入口 | 在渲染根组件前调用 `await initLocale()` |
| 组件库集成 | `<rtc-agent>` 根组件 `connectedCallback` | 使用 `once` 标志确保只初始化一次 |

**推荐**: 在 `<rtc-agent>` 根组件中初始化，保持组件库的自包含性。

```typescript
// rtc-agent.ts
import { initLocale } from './core/i18n.js';

let localeInitialized = false;

@customElement('rtc-agent')
export class RtcAgent extends LitElement {
  async connectedCallback() {
    super.connectedCallback();
    if (!localeInitialized) {
      localeInitialized = true;
      await initLocale();
    }
  }
}
```

### 4.6 LocaleController

为简化组件接入，封装 `@consume` 和默认值逻辑为 Reactive Controller：

**文件**: `src/core/locale-controller.ts`

```typescript
import { type ReactiveController, type ReactiveControllerHost } from 'lit';
import { consume } from '@lit/context';
import { localeContext, type LocaleContextValue, sourceLocale, targetLocales } from './i18n.js';

/**
 * 封装 locale context 消费逻辑，减少组件样板代码
 * 
 * @example
 * ```typescript
 * @customElement('rtc-settings')
 * export class RtcSettings extends LitElement {
 *   private _locale = new LocaleController(this);
 *   
 *   render() {
 *     return html`<p>当前: ${this._locale.locale}</p>`;
 *   }
 * }
 * ```
 */
export class LocaleController implements ReactiveController {
  @consume({ context: localeContext, subscribe: true })
  private _value: LocaleContextValue = {
    locale: sourceLocale,
    setLocale: async () => {
      console.warn('[LocaleController] Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  constructor(_host: ReactiveControllerHost) {
    _host.addController(this);
  }

  get locale() {
    return this._value.locale;
  }

  get locales() {
    return this._value.locales;
  }

  hostUpdated() {
    // Context 值变化时自动触发重渲染
  }
}
```

### 4.7 动态内容国际化规则

| 场景 | 处理方式 | 示例 |
| --- | --- | --- |
| 错误消息模板 | `msg()` + `str` 模板 | `msg(str\`连接失败: ${error}\`)` |
| 后端返回的错误文本 | API 层约定 `locale` 参数，后端返回对应语言 | `GET /api/errors?locale=en-US` |
| 用户生成内容 | 不做翻译，保持原文 | 聊天消息、文件名 |
| 日期/时间 | `Intl.DateTimeFormat`，locale 从 context 获取 | `new Intl.DateTimeFormat(locale).format(date)` |
| 数字/货币 | `Intl.NumberFormat`，locale 从 context 获取 | `new Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY' }).format(amount)` |
| 复数形式 | `msg()` 支持 ICU 复数语法 | `msg(html\`${count} 个文件\`, { id: 'file-count' })` |

---

## 5. 迁移策略

### 5.1 分阶段实施

| 阶段 | 内容 | 风险 | 预估工作量 |
| --- | --- | --- | --- |
| **Phase 0** | 安装依赖、配置工具链、创建 i18n 核心模块 | 零影响 | 0.5 天 |
| **Phase 1** | 改造 2-3 个核心组件（login、settings、empty-state） | 低风险 | 1 天 |
| **Phase 2a** | 批量改造高频组件（activity-bar、session-header、status-bar 等 UI 框架组件，约 12 个） | 中风险 | 2 天 |
| **Phase 2b** | 批量改造剩余组件（对话框、弹窗、工具提示等，约 14 个） | 中风险 | 2 天 |
| **Phase 3** | 补充英文翻译、添加语言切换 UI | 低风险 | 2 天 |

### 5.2 改造范围

- **组件数量**: 41 个
- **需改造文件**: 至少 29 个（含硬编码中文）
- **预估文本数**: 150-200 处

---

## 6. 风险与缓解

| 风险 | 缓解措施 |
| --- | --- |
| `msg()` 包裹遗漏 | CI 运行 `lit-localize lint` 检查硬编码中文（见 §4.3） |
| 翻译未就绪时显示 msg ID | `sourceLocale = 'zh-CN'`，现有中文即源语言，零翻译也可运行 |
| `@localized()` 重复渲染性能 | Lit 的 diff 机制已优化；非文本节点不会重绘 |
| 动态内容中的文本（如错误消息） | 遵循 §4.7 动态内容国际化规则逐一审查 |
| 第三方组件未国际化 | 通过 slot 或属性传递翻译文本 |
| 组件未包裹在 locale context 中 | 使用 LocaleController（§4.6）提供安全默认值 |

---

## 7. 不做的事情

- ❌ 不做 transform 模式（需要多构建产物，增加复杂度）
- ❌ 不引入第三方翻译管理平台（初期手动维护 XLIFF 即可）
- ❌ 不改造 `relative-time.ts`（它已用 `Intl.RelativeTimeFormat`，与 @lit/localize 独立）
- ❌ 不做服务端渲染优化（Web Component 场景不需要）

---

## 8. 依赖变更

### 新增依赖

```json
{
  "dependencies": {
    "@lit/localize": "^0.12.0"
  },
  "devDependencies": {
    "@lit/localize-tools": "^0.8.0"
  }
}
```

### .gitignore 新增

```gitignore
# i18n generated files — 勿手动编辑
src/.generated/
```

> 使用隐藏目录 `.generated/` 而非 `generated/`，明确标识这些文件为构建产物。

---

## 9. 测试策略

### 单元测试

验证核心模块和 `msg()` 在不同 locale 下的行为：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { initLocale, switchLocale, isValidLocale, sourceLocale } from '../core/i18n.js';

describe('i18n core', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
  });

  it('isValidLocale 识别合法 locale', () => {
    expect(isValidLocale('zh-CN')).toBe(true);
    expect(isValidLocale('en-US')).toBe(true);
    expect(isValidLocale('fr-FR')).toBe(false);
  });

  it('getInitialLocale 优先读取 localStorage', async () => {
    localStorage.setItem('rtc-agent-locale', 'en-US');
    await initLocale();
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('getInitialLocale 回退到浏览器语言', async () => {
    // 模拟 navigator.language = 'en-US'
    await initLocale();
    expect(['zh-CN', 'en-US']).toContain(document.documentElement.lang);
  });

  it('switchLocale 同步 lang 属性和 localStorage', async () => {
    await switchLocale('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(localStorage.getItem('rtc-agent-locale')).toBe('en-US');
  });

  it('未知 locale 抛出明确错误', async () => {
    await expect(switchLocale('fr-FR' as any)).rejects.toThrow('[i18n] Unknown locale');
  });
});
```

### 组件集成测试

验证 `@localized()` 组件在语言切换后重新渲染：

```typescript
import { fixture, html, expect } from '@open-wc/testing';
import { switchLocale } from '../core/i18n.js';
import '../rtc-settings-panel.js';

describe('rtc-settings-panel i18n', () => {
  it('zh-CN 下显示中文文本', async () => {
    await switchLocale('zh-CN');
    const el = await fixture(html`<rtc-settings-panel></rtc-settings-panel>`);
    expect(el.shadowRoot!.querySelector('h2')!.textContent).toBe('设置');
  });

  it('en-US 下显示英文文本', async () => {
    await switchLocale('en-US');
    const el = await fixture(html`<rtc-settings-panel></rtc-settings-panel>`);
    expect(el.shadowRoot!.querySelector('h2')!.textContent).toBe('Settings');
  });

  it('aria-label 随 locale 变化', async () => {
    await switchLocale('en-US');
    const el = await fixture(html`<rtc-settings-panel></rtc-settings-panel>`);
    const btn = el.shadowRoot!.querySelector('button[aria-label]');
    expect(btn!.getAttribute('aria-label')).toBe('Close settings');
  });
});
```

### E2E 测试

验证设置面板的语言选择器功能：

```typescript
import { test, expect } from '@playwright/test';

test.describe('语言切换', () => {
  test('切换语言后整个应用文本更新', async ({ page }) => {
    await page.goto('/');
    // 打开设置面板
    await page.click('[data-testid="settings-button"]');
    // 选择英文
    await page.selectOption('select', 'en-US');
    // 验证应用文本已切换
    await expect(page.locator('rtc-activity-bar')).toContainText('Chat');
    // 验证 lang 属性已更新
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  });

  test('刷新页面后语言偏好保持', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="settings-button"]');
    await page.selectOption('select', 'en-US');
    await page.reload();
    // 验证刷新后仍为英文
    await expect(page.locator('rtc-activity-bar')).toContainText('Chat');
  });

  test('语言选择器正确高亮当前 locale', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="settings-button"]');
    const selected = await page.locator('select').evaluate(
      (el) => (el as HTMLSelectElement).value
    );
    expect(selected).toBe('zh-CN');
  });
});
```

### 覆盖率目标

| 模块 | 目标覆盖率 | 说明 |
| --- | --- | --- |
| `core/i18n.ts` | 100% | 核心逻辑，全部覆盖 |
| `core/locale-controller.ts` | 100% | Controller 封装 |
| 组件 `render()` | ≥ 80% | 至少验证 msg() 在两种 locale 下的输出 |

---

## 10. 附录

### 10.1 需改造的组件清单

**生成完整清单**: 运行以下命令获取所有包含硬编码中文的文件列表：

```bash
# 扫描 src/ 下所有 .ts 文件中的中文字符
grep -rl '[一-鿿]' web-components/packages/component/src/ --include="*.ts" | sort
```

**已确认需改造的核心组件**:

| 文件 | 硬编码文本示例 |
| --- | --- |
| `rtc-login-dialog.ts` | 登录成功/失败、重试、关闭等 |
| `rtc-settings-panel.ts` | 设置、关闭设置 |
| `rtc-empty-state.ts` | hintText 默认值 |
| `rtc-activity-bar.ts` | 聊天、文件、通知等标签 |
| `rtc-status-bar.ts` | 连接状态 |
| `rtc-session-header.ts` | 会话操作按钮 |

> 完整清单见 `scripts/i18n-scan.ts`（Phase 0 创建）。

### 10.2 参考资源

- [Lit Localize 文档](https://lit.dev/docs/localization/overview/)
- [@lit/localize npm](https://www.npmjs.com/package/@lit/localize)
- [@lit/localize-tools npm](https://www.npmjs.com/package/@lit/localize-tools)
