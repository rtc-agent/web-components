import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Vite 构建配置：
// - 入口：src/index.ts（注册所有 Web Components）
// - 输出：dist/index.js（UMD/ESM 兼容）
// - Lit 的装饰器需要 experimentalDecorators（已在 tsconfig 开启）

export default defineConfig(({ mode }) => ({
  // 使用相对路径，这样组件部署在任意子路径（如 /rtc-agent/）时资源都能正确解析
  base: './',
  plugins: [
    nodePolyfills({
      include: ['path', 'buffer', 'process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  define: {
    // Babel 和其他 Node.js 库可能引用 process.env，在浏览器环境中需要定义
    // 根据实际构建模式动态设置 NODE_ENV，确保生产构建能正确 tree-shake
    'process.env.NODE_ENV': JSON.stringify(
      mode === 'development' ? 'development' : 'production',
    ),
    'process.env': JSON.stringify({}),
  },
  resolve: {
    // 开发时直接解析 workspace 包到源码，跳过 dist/，实现热更新
    alias: {
      '@rtc-agent/client': path.resolve(__dirname, '../client/src/index.ts'),
      '@rtc-agent/persistence': path.resolve(
        __dirname,
        '../persistence/src/index.ts',
      ),
      '@rtc-agent/protocol': path.resolve(
        __dirname,
        '../protocol/src/index.ts',
      ),
      '@rtc-agent/worker': path.resolve(__dirname, '../worker/src/index.ts'),
    },
  },
  optimizeDeps: {
    // 阻止 Vite 预打包 workspace 包，否则其嵌套 import 仍走 dist/
    exclude: [
      '@rtc-agent/client',
      '@rtc-agent/persistence',
      '@rtc-agent/protocol',
      '@rtc-agent/worker',
    ],
  },
  build: {
    // 生成 JS sourcemap，便于生产环境调试和问题定位
    // 生产环境使用 'hidden'：生成 .map 文件但不在 JS 中引用，避免暴露源码
    // 开发环境使用 true：生成 .map 文件并在 JS 中添加引用
    // 注意：persistence 包使用 tsup 构建，通过 remove-sourcemap-refs.mjs 脚本实现相同效果
    sourcemap: mode === 'development' ? true : 'hidden',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'], // P0-FIX: ES format only to enable code splitting (UMD forces inlineDynamicImports)
      fileName: (format) => 'index.js',
      name: 'RtcAgentModule',
    },
    rollupOptions: {
      // Lit 作为外部依赖还是打包进来？
      // Web Component 通常是独立使用，所以把 Lit 打包进来更友好。
      // 如需外部化，可在此处添加 external: ['lit']
      output: {
        // P0-FIX: Code splitting by functionality for better caching and loading performance
        manualChunks(id) {
          // Vendor bundles: third-party libraries
          if (id.includes('node_modules/lit/') || id === 'lit') {
            return 'vendor-lit';
          }
          // Core modules: internal functionality (merged to avoid circular dependencies)
          if (id.includes('/src/core/') || id.includes('/src/controllers/')) {
            return 'core-controllers';
          }
          if (id.includes('/src/components/')) {
            return 'components-ui';
          }
        },
      },
    },
  },
  server: {
    fs: {
      allow: [path.resolve('.'), path.resolve('..')],
    },
  },
  worker: {
    // Worker 构建配置：使用 ESM 格式避免 IIFE 与代码分割冲突
    format: 'es',
  },
}));
