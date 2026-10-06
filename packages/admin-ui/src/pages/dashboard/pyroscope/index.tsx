/**
 * Pyroscope 性能剖析面板
 *
 * 通过 iframe 嵌入 Pyroscope UI，由 Admin Server 反向代理。
 */

import { GridContent } from '@ant-design/pro-components';
import { Card } from 'antd';
import type { FC } from 'react';

const PyroscopeDashboard: FC = () => {
  const iframeSrc = '/api/pyroscope/';

  return (
    <GridContent>
      <Card
        variant="borderless"
        styles={{ body: { padding: 0, height: 'calc(100vh - 140px)' } }}
      >
        <iframe
          src={iframeSrc}
          title="Pyroscope Profiling"
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

export default PyroscopeDashboard;
