import { defineConfig } from 'vite';
import path from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Vite 构建配置：
// - 入口：src/index.ts（注册所有 Web Components）
// - 输出：dist/index.js（UMD/ESM 兼容）
// - Lit 的装饰器需要 experimentalDecorators（已在 tsconfig 开启）

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['path', 'buffer', 'process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  define: {
    // Babel 和其他 Node.js 库可能引用 process.env，在浏览器环境中需要定义
    'process.env.NODE_ENV': JSON.stringify('development'),
    'process.env': JSON.stringify({}),
  },
  resolve: {
    // 开发时直接解析 workspace 包到源码，跳过 dist/，实现热更新
    alias: {
      '@rtc-agent/client': path.resolve(__dirname, '../client/src/index.ts'),
      '@rtc-agent/persistence': path.resolve(__dirname, '../persistence/src/index.ts'),
    },
  },
  optimizeDeps: {
    // 阻止 Vite 预打包 workspace 包，否则其嵌套 import 仍走 dist/
    exclude: ['@rtc-agent/client', '@rtc-agent/persistence'],
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'umd'],
      fileName: (format) => format === 'es' ? 'index.js' : 'index.umd.js',
      name: 'RtcAgentModule',
    },
    rollupOptions: {
      // Lit 作为外部依赖还是打包进来？
      // Web Component 通常是独立使用，所以把 Lit 打包进来更友好。
      // 如需外部化，可在此处添加 external: ['lit']
    },
  },
  server: {
    // 允许从上级 debug 目录访问测试页面
    fs: {
      allow: [path.resolve('../../debug'), path.resolve('.'), path.resolve('..')],
    },
  },
});
