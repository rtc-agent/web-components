// https://umijs.org/config/

import { join } from 'node:path';
import { defineConfig } from '@umijs/max';
import defaultSettings from './defaultSettings';
import proxy from './proxy';

import routes from './routes';

const { UMI_ENV = 'dev' } = process.env;

// Compute commit hash: env vars take precedence, fall back to git at build time
const commitHash =
  process.env.COMMIT_HASH ||
  process.env.CF_PAGES_COMMIT_SHA ||
  (() => {
    try {
      return require('node:child_process')
        .execSync('git rev-parse HEAD', {
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf-8',
        })
        .trim();
    } catch {
      return '';
    }
  })();

/**
 * @name 使用公共路径
 * @description 部署时的路径，如果部署在非根目录下，需要配置这个变量
 * @doc https://umijs.org/docs/api/config#publicpath
 */
const PUBLIC_PATH: string = '/';

export default defineConfig({
  alias: {
    '@root': join(__dirname, '..'),
  },
  /**
   * @name 开启 hash 模式
   * @description 让 build 之后的产物包含 hash 后缀。通常用于增量发布和避免浏览器加载缓存。
   * @doc https://umijs.org/docs/api/config#hash
   */
  hash: true,

  publicPath: PUBLIC_PATH,

  /**
   * @name 兼容性设置
   * @description 设置 ie11 不一定完美兼容，需要检查自己使用的所有依赖
   * @doc https://umijs.org/docs/api/config#targets
   */
  // targets: {
  //   ie: 11,
  // },
  /**
   * @name 路由的配置，不在路由中引入的文件不会编译
   * @description 只支持 path，component，routes，redirect，wrappers，title 的配置
   * @doc https://umijs.org/docs/guides/routes
   */
  // umi routes: https://umijs.org/docs/routing
  routes,
  /**
   * @name 主题的配置
   * @description 虽然叫主题，但是其实只是 less 的变量设置
   * @doc antd的主题设置 https://ant.design/docs/react/customize-theme-cn
   * @doc umi 的 theme 配置 https://umijs.org/docs/api/config#theme
   */
  // theme: { '@primary-color': '#1DA57A' }
  /**
   * @name moment 的国际化配置
   * @description 如果对国际化没有要求，打开之后能减少js的包大小
   * @doc https://umijs.org/docs/api/config#ignoremomentlocale
   */
  ignoreMomentLocale: true,
  /**
   * @name 代理配置
   * @description 可以让你的本地服务器代理到你的服务器上，这样你就可以访问服务器的数据了
   * @see 要注意以下 代理只能在本地开发时使用，build 之后就无法使用了。
   * @doc 代理介绍 https://umijs.org/docs/guides/proxy
   * @doc 代理配置 https://umijs.org/docs/api/config#proxy
   */
  proxy: proxy[UMI_ENV as keyof typeof proxy],
  /**
   * @name 快速热更新配置
   * @description 一个不错的热更新组件，更新时可以保留 state
   */
  fastRefresh: true,
  /**
   * @name 路由预加载
   * @description 预加载路由资源，提升页面切换速度
   * @doc https://umijs.org/docs/api/config#routePrefetch
   */
  routePrefetch: {},
  /**
   * @name manifest 配置
   * @description 生成资源清单，配合 routePrefetch 使用
   */
  manifest: {},
  //============== 以下都是max的插件配置 ===============
  /**
   * @name 数据流插件
   * @@doc https://umijs.org/docs/max/data-flow
   */
  model: {},
  /**
   * 一个全局的初始数据流，可以用它在插件之间共享数据
   * @description 可以用来存放一些全局的数据，比如用户信息，或者一些全局的状态，全局初始状态在整个 Umi 项目的最开始创建。
   * @doc https://umijs.org/docs/max/data-flow#%E5%85%A8%E5%B1%80%E5%88%9D%E5%A7%8B%E7%8A%B6%E6%80%81
   */
  initialState: {},
  /**
   * @name layout 插件
   * @doc https://umijs.org/docs/max/layout-menu
   */
  title: 'Ant Design Pro',
  layout: {
    locale: true,
    ...defaultSettings,
  },
  /**
   * @name moment2dayjs 插件
   * @description 将项目中的 moment 替换为 dayjs
   * @doc https://umijs.org/docs/max/moment2dayjs
   */
  moment2dayjs: {
    preset: 'antd',
    plugins: ['duration', 'relativeTime'],
  },
  /**
   * @name 国际化插件
   * @doc https://umijs.org/docs/max/i18n
   */
  locale: {
    // default zh-CN
    default: 'zh-CN',
    antd: true,
    // default true, when it is true, will use `navigator.language` overwrite default
    baseNavigator: true,
  },
  /**
   * @name antd 插件
   * @description 内置了 babel import 插件
   * @doc https://umijs.org/docs/max/antd#antd
   */
  antd: {
    appConfig: {},
    configProvider: {
      theme: {
        token: {
          fontFamily: 'AlibabaSans, sans-serif',
        },
      },
    },
  },
  /**
   * @name 网络请求配置
   * @description 它基于 axios 和 ahooks 的 useRequest 提供了一套统一的网络请求和错误处理方案。
   * @doc https://umijs.org/docs/max/request
   */
  request: {},
  /**
   * @name React Query 插件
   * @description 使用 react-query 管理服务端状态
   * @doc https://umijs.org/docs/max/react-query
   */
  reactQuery: {
    queryClient: {
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          refetchOnMount: true,
          retry: false,
          staleTime: 5 * 60 * 1000,
          gcTime: 10 * 60 * 1000,
        },
        mutations: {
          gcTime: 0,
        },
      },
    },
  },
  /**
   * @name 权限插件
   * @description 基于 initialState 的权限插件，必须先打开 initialState
   * @doc https://umijs.org/docs/max/access
   */
  access: {},
  /**
   * @name Google Analytics
   * @description 使用 GA4 (gtag.js) 进行站点分析
   * @doc https://umijs.org/docs/max/analytics
   */
  analytics: process.env.GA_ID ? {
    ga_v2: process.env.GA_ID,
  } : undefined,
  /**
   * @name <head> 中额外的 meta 标签
   * @description Content Security Policy (CSP) 防止 XSS / 数据注入攻击。
   * - script-src 已移除 'unsafe-inline'，所有脚本通过外部文件或 nonce 方式加载。
   * - style-src 保留 'unsafe-inline'：antd 动态样式和 CSS-in-JS 需要内联样式支持。
   * - connect-src 需要放行 GA（googletagmanager / google-analytics）以及 WS 协议，
   *   供 rtc-agent 组件连接 Centrifuge WebSocket。
   *
   * ⚠️ **安全风险提示**：
   * 当前 connect-src 使用 `wss: https:` 限制，仅允许加密协议连接。
   * 这是为了支持 rtc-agent 连接用户配置的 Centrifuge 端点（域名不固定）。
   *
   * **已实施的安全措施**（2026-10-14 增强）：
   * - 移除不安全的 `ws:` 和 `http:` 协议，强制使用加密连接
   * - 防止中间人攻击和数据窃听
   * - 添加详细的注释和文档说明生产环境要求
   *
   * **潜在风险**：
   * - 仍允许连接任意域名的加密连接
   * - 如果页面存在 XSS 漏洞，攻击者可利用此策略向任意外域发送数据
   *
   * **生产环境要求**（必须实施）：
   * 1. 实现代理层白名单：rtc-agent WebSocket 连接通过后端代理，CSP 仅需放行代理域名
   * 2. 动态 CSP：在运行时根据用户配置的 Centrifuge 端点动态生成 CSP 策略
   * 3. 限制 connect-src 到特定的已知域名：
   *    ```typescript
   *    connect-src 'self'
   *      https://www.google-analytics.com
   *      wss://*.centrifugo.com
   *      https://api.your-backend.com
   *    ```
   *
   * **迁移计划**：
   * - 短期（当前）：添加详细注释和文档，强调生产环境要求
   * - 中期：实现后端代理，rtc-agent 连接通过代理转发
   * - 长期：实现动态 CSP 生成，根据运行时配置自动调整策略
   *
   * - frame-ancestors 'none' 禁止任何站点嵌套本页面，避免点击劫持。
   */
  metas: [
    {
      httpEquiv: 'Content-Security-Policy',
      content: [
        "default-src 'self'",
        "script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https://www.google-analytics.com wss: https:",
        // TODO(P2, Security, 2026-Q4): connect-src 使用 wss: https: 过于宽松，允许连接任意加密域名。
        //   安全风险：如果页面存在 XSS 漏洞，攻击者可利用此策略向任意外域发送数据。
        //   迁移计划：(1) 短期 - 实现后端代理层，rtc-agent WebSocket 连接通过代理转发，CSP 仅需放行代理域名；
        //            (2) 中期 - 实现动态 CSP，根据运行时配置的 Centrifuge 端点自动生成策略；
        //            (3) 长期 - 限制 connect-src 到特定的已知域名白名单。
        //   参考文档：见本文件上方详细的安全风险分析和实施方案说明（lines 199-236）。
        "font-src 'self' data:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    },
  ],
  /**
   * @name <head> 中额外的 script
   * @description 配置 <head> 中额外的 script
   * 所有脚本均通过外部文件加载，符合 CSP 规范（不使用 unsafe-inline）
   */
  headScripts: [
    // 解决首次加载时白屏的问题
    { src: join(PUBLIC_PATH, 'scripts/loading.js'), async: true },
    // Set document direction based on browser language (early initialization)
    { src: join(PUBLIC_PATH, 'scripts/set-dir.js') },
  ],

  //================ pro 插件配置 =================
  plugins: ['@umijs/max-plugin-openapi', '@umijs/request-record'],

  /**
   * @name openAPI 插件的配置
   * @description 基于 openapi 的规范生成serve 和mock，能减少很多样板代码
   * @doc https://pro.ant.design/zh-cn/docs/openapi/
   */
  openAPI: [
    {
      requestLibPath: "import { request } from '@umijs/max'",
      // 或者使用在线的版本
      // schemaPath: "https://gw.alipayobjects.com/os/antfincdn/M%24jrzTTYJN/oneapi.json"
      schemaPath: join(__dirname, 'oneapi.json'),
      mock: false,
    },
  ],

  tailwindcss: {},

  mock: {
    include: ['mock/**/*', 'src/pages/**/_mock.ts'],
    exclude: ['mock/requestRecord.mock.js'],
  },
  chainWebpack(webpackConfig) {
    webpackConfig.module
      .rule('md-raw')
      .test(/\.md$/)
      .use('md-raw-loader')
      .loader(join(__dirname, 'md-raw-loader.cjs'))
      .end();
  },
  esbuildMinifyIIFE: true,
  requestRecord: {},
  exportStatic: {},
  define: {
    'process.env.CI': process.env.CI,
    'process.env.COMMIT_HASH': commitHash,
    'process.env.RTC_AGENT_URL': process.env.RTC_AGENT_URL || '',
    __APP_VERSION__: require('./../package.json').version,
    __UMI_VERSION__: require('@umijs/max/package.json').version,
    __UTOO_VERSION__: (() => {
      try {
        return require('@utoo/pack/package.json').version;
      } catch {
        return 'N/A (utoopack disabled)';
      }
    })(),
  },
});
