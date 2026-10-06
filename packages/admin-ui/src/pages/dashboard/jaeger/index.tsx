/**
 * Jaeger 分布式追踪面板
 *
 * 通过 iframe 嵌入 Jaeger UI，由 Admin Server 反向代理。
 */

import { GridContent } from '@ant-design/pro-components';
import { Card } from 'antd';
import type { FC } from 'react';

const JaegerDashboard: FC = () => {
  const iframeSrc = '/api/jaeger/';

  return (
    <GridContent>
      <Card
        variant="borderless"
        styles={{ body: { padding: 0, height: 'calc(100vh - 140px)' } }}
      >
        <iframe
          src={iframeSrc}
          title="Jaeger Tracing"
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

export default JaegerDashboard;
