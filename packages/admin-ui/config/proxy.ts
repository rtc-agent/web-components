/**
 * @name 代理的配置
 * @see 在生产环境 代理是无法生效的，所以这里没有生产环境的配置
 * -------------------------------
 * The agent cannot take effect in the production environment
 * so there is no configuration of the production environment
 * For details, please see
 * https://pro.ant.design/docs/deploy
 *
 * @doc https://umijs.org/docs/guides/proxy
 */
export default {
  /**
   * 开发环境代理配置
   * Auth 相关接口代理到真实的 admin-server，其他接口使用 mock
   */
  dev: {
    // Auth 相关接口代理到真实后端（Docker 模式）
    '/api/auth/': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    '/api/currentUser': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    // RTC 用户管理接口代理到 admin-server
    '/api/rtc-users': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    // 系统配置管理接口代理到 admin-server
    '/api/configs': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    // Prometheus 指标代理到 admin-server
    '/api/metrics': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    // Grafana 监控面板代理到 admin-server
    '/api/grafana/': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    // Jaeger 分布式追踪面板代理到 admin-server
    '/api/jaeger/': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    // Pyroscope 性能剖析面板代理到 admin-server
    '/api/pyroscope/': {
      target: 'http://localhost:28081',
      changeOrigin: true,
    },
    // RTC Agent Server 代理（Token Exchange + WebSocket）
    '/oauth2/': {
      target: 'http://localhost:28080',
      changeOrigin: true,
    },
    // Centrifuge WebSocket 连接（组件使用 /connection/websocket 路径）
    '/connection/': {
      target: 'http://localhost:28080',
      changeOrigin: true,
      ws: true, // WebSocket 支持
    },
    '/centrifuge/': {
      target: 'http://localhost:28080',
      changeOrigin: true,
      ws: true, // WebSocket 支持
    },
    // 其他 /api/ 请求不走代理，由 mock 处理
  },
  test: {
    '/api/': {
      target: 'https://pro-api.ant-design-demo.workers.dev',
      changeOrigin: true,
    },
  },
  pre: {
    '/api/': {
      target: 'your pre url',
      changeOrigin: true,
    },
  },
};
