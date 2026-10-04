/**
 * Test page for GlobalRtcAgent component
 * This page verifies that the RTC Agent can be mounted without React context errors.
 */

import { PageContainer } from '@ant-design/pro-components';
import { Button, Card, message, Space } from 'antd';
import React, { useEffect, useRef, useState } from 'react';

export default function RtcAgentTestPage() {
  const [status, setStatus] = useState<string>('Checking...');
  const [error, setError] = useState<string | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check if GlobalRtcAgent is mounted
    const checkAgent = () => {
      const agent = document.querySelector('rtc-agent');
      if (agent) {
        setStatus('✅ RTC Agent is mounted');
        setError(null);
      } else {
        setStatus(
          '⚠️ RTC Agent is not mounted (this is normal if you are not logged in)',
        );
        setError(null);
      }
    };

    // Check immediately
    checkAgent();

    // Check again after 2 seconds (in case of delayed mounting)
    const timer = setTimeout(checkAgent, 2000);

    return () => {
      clearTimeout(timer);
      // Also clean up any test agent timer
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }
    };
  }, []);

  const handleTestMount = async () => {
    // Prevent double-mount
    if (document.querySelector('rtc-agent[data-test-agent="true"]')) {
      message.warning('测试 agent 已在运行中');
      return;
    }

    try {
      setStatus('Testing dynamic import...');
      const { createRtcAgent } = await import('@rtc-agent/component');

      const agent = createRtcAgent({
        appLabel: 'Test Agent',
        server: { url: window.location.origin },
        workerURL: '/rtc-agent/shared-worker.js',
        databaseName: 'admin-ui-test',
        window: { defaultMode: 'minimized' },
      });

      // Mark as test agent for identification
      agent.setAttribute('data-test-agent', 'true');
      document.body.appendChild(agent);
      setStatus('✅ Test agent mounted successfully');

      cleanupTimerRef.current = setTimeout(() => {
        try {
          agent.destroy();
          setStatus('✅ Test agent destroyed');
        } catch (e) {
          console.warn('Failed to destroy test agent:', e);
        }
        cleanupTimerRef.current = null;
      }, 2000);
    } catch (e) {
      setError(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
      setStatus('❌ Test failed');
    }
  };

  return (
    <PageContainer>
      <Card title="RTC Agent Integration Test">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <h3>Status</h3>
            <p>{status}</p>
            {error && <p style={{ color: 'red' }}>{error}</p>}
          </div>

          <div>
            <h3>Actions</h3>
            <Space>
              <Button type="primary" onClick={handleTestMount}>
                Test Dynamic Import
              </Button>
              <Button onClick={() => window.location.reload()}>
                Reload Page
              </Button>
            </Space>
          </div>

          <div>
            <h3>Console</h3>
            <p>Open the browser console to see detailed logs.</p>
            <p>
              If you see "TypeError: Cannot destructure property 'dispatcher' of
              'useContext(...)'" in the console, the integration is broken.
            </p>
          </div>
        </Space>
      </Card>
    </PageContainer>
  );
}
