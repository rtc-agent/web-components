/**
 * Grafana 监控面板
 *
 * 通过 iframe 嵌入 Grafana 仪表盘，由 Admin Server 反向代理。
 * 根据 URL 路径中最后一段作为 dashboard UID 加载对应仪表盘。
 */

import { GridContent } from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Card } from 'antd';
import type { FC } from 'react';

const GrafanaDashboard: FC = () => {
  const location = useLocation();
  // 从 URL 路径中提取 dashboard UID（最后一段）
  const segments = location.pathname.split('/').filter(Boolean);
  const uid = segments[segments.length - 1];

  const iframeSrc =
    uid && uid !== 'grafana'
      ? `/api/grafana/d/${uid}/${uid}?orgId=1&refresh=30s`
      : '/api/grafana/';

  return (
    <GridContent>
      <Card
        variant="borderless"
        styles={{ body: { padding: 0, height: 'calc(100vh - 140px)' } }}
      >
        <iframe
          src={iframeSrc}
          title="Grafana Dashboard"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          allowFullScreen
        />
      </Card>
    </GridContent>
  );
};

export default GrafanaDashboard;
