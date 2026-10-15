# Sourcemap Strategy

RTC Agent Web Components monorepo 中各包的 sourcemap 策略。

## 概览

| Package | Build Tool | Strategy | Dev | Prod `.map` | Browser Visible |
|---------|-----------|----------|-----|-------------|-----------------|
| `component` | Vite | `hidden` | `true` | Yes | No |
| `persistence` | tsup + script | `true` + post-process | `true` | Yes | No |
| `admin-ui` | Umi Max | Framework default | Yes | Yes | No (Umi handles) |

## 为什么使用 Hidden Sourcemap

1. **生产调试**: 错误追踪工具（Sentry、Datadog RUM）可上传 `.map` 文件，将堆栈还原为源码行号
2. **源码保护**: 用户无法通过浏览器 DevTools 查看原始代码，防止逆向工程
3. **安全**: 隐藏内部 API 路径、业务逻辑、未混淆的代码结构

## 各包详情

### component (Vite)

```ts
// vite.config.ts
export default defineConfig(({ mode }) => ({
  build: {
    sourcemap: mode === 'development' ? true : 'hidden',
  },
}));
```

- **开发环境**: 生成完整 sourcemap（`.map` 文件 + JS 中的 `//# sourceMappingURL` 引用）
- **生产环境**: Vite `'hidden'` 模式 -- 生成 `.map` 文件但不在 JS 中添加引用注释
- **产物**: `dist/` 下同时有 `.js` 和 `.js.map` 文件

### persistence (tsup)

```ts
// tsup.config.ts
export default defineConfig({
  sourcemap: true,
});
```

```json
// package.json
{
  "scripts": {
    "build": "tsup && node ../../scripts/remove-sourcemap-refs.js"
  }
}
```

tsup 只支持 `boolean | 'inline'` 的 sourcemap 选项，没有原生 `'hidden'` 模式。通过自定义脚本 `scripts/remove-sourcemap-refs.js` 实现等效效果：

1. `tsup` 生成 `.js` + `.js.map`（JS 中包含 `//# sourceMappingURL` 引用）
2. `remove-sourcemap-refs.js` 扫描 `dist/**/*.js`，移除所有 `//# sourceMappingURL=` 注释
3. 结果：`.map` 文件保留在磁盘，但浏览器无法发现

### admin-ui (Umi Max)

admin-ui 使用 Umi Max 内置的构建系统，sourcemap 行为由 Umi 框架默认管理。生产构建通常不生成 sourcemap（由 Umi 的 `devtool` 配置控制）。

## 上传到错误追踪工具

以 Sentry 为例：

```bash
# 使用 sentry-cli 上传 hidden sourcemaps
sentry-cli sourcemaps upload \
  --org my-org \
  --project rtc-agent \
  --release "$VERSION" \
  --url-prefix "~/assets" \
  dist/
```

上传后，Sentry 会将生产环境的错误堆栈还原为源码行号，而终端用户仍无法在浏览器中看到源码。

## 注意事项

- `.map` 文件不应部署到公开 CDN，仅上传到内部错误追踪系统
- 确保 `.gitignore` 排除 `*.tsbuildinfo`（已配置）
- 本地开发无需关心此策略，所有环境默认有完整 sourcemap
