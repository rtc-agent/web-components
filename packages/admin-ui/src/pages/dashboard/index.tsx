/**
 * Dashboard Page
 *
 * Main dashboard page that integrates the <rtc-agent> Web Component.
 * Uses AuthProvider with 'token-exchange' mode to authenticate with the RTC Agent.
 */

import React, { useEffect, useRef } from 'react';
import { Typography } from 'antd';
import { createRtcAgent, whenReady as readyPromise } from '@rtc-agent/component';
import type { RtcAgentWithLifecycle } from '@rtc-agent/component';
import { createAuthProvider } from '@/auth/authProvider';

const { Title } = Typography;

const rtcAgentURL = import.meta.env.VITE_RTC_AGENT_URL || '';

const DashboardPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<RtcAgentWithLifecycle | null>(null);

  useEffect(() => {
    let mounted = true;

    const initAgent = async () => {
      // Wait for the component module to be ready
      await readyPromise;

      if (!mounted || !containerRef.current) {
        return;
      }

      // Create the AuthProvider for token exchange
      const authProvider = createAuthProvider(rtcAgentURL);

      // Create the <rtc-agent> element via factory
      const agent = createRtcAgent({
        appLabel: 'Admin Console',
        theme: 'light',
        server: {
          url: rtcAgentURL,
        },
        auth: authProvider,
        window: {
          defaultMode: 'maximized',
          embedded: true,
        },
      });

      // Style the agent to fill the container
      agent.style.width = '100%';
      agent.style.height = '100%';

      // Append to container
      containerRef.current.appendChild(agent);
      agentRef.current = agent;
    };

    initAgent();

    return () => {
      mounted = false;
      // Cleanup: destroy the agent instance
      if (agentRef.current) {
        agentRef.current.destroy();
        agentRef.current = null;
      }
    };
  }, []);

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <Title level={4} style={{ margin: 0 }}>
          AI Assistant
        </Title>
      </div>
      <div ref={containerRef} style={containerStyle} />
    </div>
  );
};

// ========== Styles ==========

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: '#fff',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 24px',
  borderBottom: '1px solid #f0f0f0',
  background: '#fafafa',
};

const containerStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
};

export default DashboardPage;
