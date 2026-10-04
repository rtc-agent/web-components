import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Dashboard Page
 *
 * Main dashboard page that integrates the <rtc-agent> Web Component.
 * Uses AuthProvider with 'token-exchange' mode to authenticate with the RTC Agent.
 */
import { useEffect, useRef } from 'react';
import { Typography } from 'antd';
import { createRtcAgent, whenReady as readyPromise } from '@rtc-agent/component';
import { createAuthProvider } from '@/auth/authProvider';
const { Title } = Typography;
const rtcAgentURL = import.meta.env.VITE_RTC_AGENT_URL || '';
const DashboardPage = () => {
    const containerRef = useRef(null);
    const agentRef = useRef(null);
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
    return (_jsxs("div", { style: pageStyle, children: [_jsx("div", { style: headerStyle, children: _jsx(Title, { level: 4, style: { margin: 0 }, children: "AI Assistant" }) }), _jsx("div", { ref: containerRef, style: containerStyle })] }));
};
// ========== Styles ==========
const pageStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#fff',
};
const headerStyle = {
    padding: '16px 24px',
    borderBottom: '1px solid #f0f0f0',
    background: '#fafafa',
};
const containerStyle = {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
};
export default DashboardPage;
//# sourceMappingURL=index.js.map