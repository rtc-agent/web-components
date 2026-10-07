/**
 * Dashboard 容器组件
 *
 * 统一管理所有 dashboard iframe：
 * - Jaeger/Pyroscope 各自一个 iframe
 * - Grafana 的每个子 tab 一个独立的 iframe（通过 CSS 控制显示/隐藏）
 * - 所有 iframe 一旦加载就保持缓存，切换时瞬间显示
 * - 支持超时销毁：长时间不访问的 iframe 自动销毁（当前使用的除外）
 */

import { useIntl, useLocation } from '@umijs/max';
import { theme } from 'antd';
import type { FC } from 'react';
import { useEffect } from 'react';
import IframePanel from '@/components/IframePanel';
import { iframeCacheManager } from '@/utils/iframe-cache';

/**
 * Grafana URL 格式说明：
 * /api/grafana/d/{dashboard-uid}/{dashboard-slug}?orgId=1&refresh=30s
 * - /api/grafana/       : 后端反向代理前缀
 * - d/                  : Grafana dashboard 路由前缀
 * - {dashboard-uid}     : dashboard 的唯一标识（URL 路径第一段）
 * - {dashboard-slug}    : dashboard 的友好名称（URL 路径第二段，通常与 uid 相同）
 * - orgId=1             : 组织 ID，Grafana 多租户场景使用
 * - refresh=30s         : 自动刷新间隔
 */

interface DashboardConfig {
  pathPrefix: string;
  cacheKey: string;
  src: string;
  /** i18n key，用于翻译 title */
  titleKey: string;
}

/**
 * 生成 Grafana 子页面的 dashboard 配置
 * 所有 Grafana 子页面遵循相同的 URL 模式，通过 slug 区分
 */
const grafanaConfig = (slug: string, titleKey: string): DashboardConfig => ({
  pathPrefix: `/dashboard/grafana/${slug}`,
  cacheKey: `grafana-${slug}`,
  src: `/api/grafana/d/${slug}/${slug}?orgId=1&refresh=30s`,
  titleKey,
});

// 所有 dashboard 配置
const DASHBOARD_CONFIGS: DashboardConfig[] = [
  {
    pathPrefix: '/dashboard/jaeger',
    cacheKey: 'jaeger',
    src: '/api/jaeger/',
    titleKey: 'dashboard.title.jaeger',
  },
  {
    pathPrefix: '/dashboard/pyroscope',
    cacheKey: 'pyroscope',
    src: '/api/pyroscope/',
    titleKey: 'dashboard.title.pyroscope',
  },
  // Grafana 的子 tab（每个 dashboard 独立一个 iframe）
  grafanaConfig('rtc-agent', 'dashboard.title.grafana.rtcAgent'),
  grafanaConfig('go-runtime', 'dashboard.title.grafana.goRuntime'),
  grafanaConfig('http-server', 'dashboard.title.grafana.httpServer'),
  grafanaConfig(
    'error-feedback-overview',
    'dashboard.title.grafana.errorFeedback',
  ),
  grafanaConfig('logs-overview', 'dashboard.title.grafana.logs'),
  grafanaConfig('oss3-overview', 'dashboard.title.grafana.oss3'),
  grafanaConfig('minio-overview', 'dashboard.title.grafana.minio'),
  grafanaConfig(
    'system-health-watchdog',
    'dashboard.title.grafana.healthWatchdog',
  ),
];

const DashboardContainer: FC = () => {
  const location = useLocation();
  const intl = useIntl();
  const { token } = theme.useToken();
  const currentPath = location.pathname;

  // 找到当前活跃的 dashboard
  const activeConfig = DASHBOARD_CONFIGS.find((config) =>
    currentPath.startsWith(config.pathPrefix),
  );

  // 设置当前活跃的 iframe key
  useEffect(() => {
    if (activeConfig) {
      iframeCacheManager.setActiveKey(activeConfig.cacheKey);
    } else {
      iframeCacheManager.setActiveKey(null);
    }
  }, [activeConfig?.cacheKey]);

  return (
    <div
      style={{
        width: '100%',
        // 140px = header 高度 (64px) + 上下 padding (24px * 2) + 额外间距 (28px)
        height: 'calc(100vh - 140px)',
        background: token.colorBgContainer,
        borderRadius: token.borderRadius,
        overflow: 'hidden',
      }}
    >
      {DASHBOARD_CONFIGS.map((config) => {
        const isVisible = currentPath.startsWith(config.pathPrefix);
        const title = intl.formatMessage({
          id: config.titleKey,
          defaultMessage: config.titleKey,
        });

        return (
          <IframePanel
            key={config.cacheKey}
            cacheKey={config.cacheKey}
            src={config.src}
            title={title}
            visible={isVisible}
          />
        );
      })}
    </div>
  );
};

export default DashboardContainer;
