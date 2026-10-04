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
