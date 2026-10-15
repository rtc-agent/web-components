/**
 * Dashboard 容器组件
 *
 * 设计意图：
 * 为何不使用 <Outlet />：
 * - Dashboard 使用 iframe 嵌入 Grafana/Jaeger/Pyroscope 等外部系统
 * - iframe 加载成本高（网络请求、资源渲染），频繁切换会导致重复加载
 * - 采用 iframe 缓存策略：所有 iframe 在组件挂载时预加载，通过 CSS display 控制显隐
 * - 切换 tab 时瞬间显示已缓存的 iframe，无需重新加载
 *
 * 子路由的作用：
 * - 菜单展示：路由配置中的 name 字段用于生成侧边栏菜单项
 * - 权限控制：父路由的 access 字段自动继承到所有子路由
 * - URL 定位：通过 URL path 标识当前激活的 dashboard tab
 *
 * 实现机制：
 * - DASHBOARD_CONFIGS 定义所有 iframe 的 pathPrefix、cacheKey、src
 * - useLocation() 获取当前路径，通过 CSS 控制匹配 iframe 的 visibility
 * - IframePanel 组件内部管理 iframe 生命周期和缓存
 * - 支持超时销毁：长时间不访问的 iframe 自动释放内存
 */

import { useIntl, useLocation } from '@umijs/max';
import type { FC } from 'react';
import { useEffect } from 'react';
import { createStyles } from 'antd-style';
import IframePanel from '@/components/IframePanel';
import { useIsMobile } from '@/hooks/useIsMobile';
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

const useStyles = createStyles(({ token }) => ({
  container: {
    width: '100%',
    // Use CSS variable for height calculation to accommodate header + padding + gap
    // Desktop fallback: 140px = header (64px) + padding (24px * 2) + gap (28px)
    // Mobile fallback: 100px = header (48px) + padding (16px * 2) + gap (20px)
    height: 'var(--dashboard-height, calc(100vh - 140px))',
    background: token.colorBgContainer,
    borderRadius: token.borderRadius,
    overflow: 'hidden',
  },
  containerMobile: {
    height: 'var(--dashboard-height-mobile, calc(100vh - 100px))',
  },
}));

const DashboardContainer: FC = () => {
  const location = useLocation();
  const intl = useIntl();
  const { styles } = useStyles();
  const isMobile = useIsMobile();
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
    <div className={isMobile ? styles.containerMobile : styles.container}>
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
