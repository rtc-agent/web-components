/**
 * RTC Agent Integration Diagnosis Page
 *
 * This page is used to diagnose whether RTC Agent integration is working properly.
 */

import { PageContainer } from '@ant-design/pro-components';
import { useIntl, useModel } from '@umijs/max';
import { Alert, App, Button, Card, Space, Typography } from 'antd';
import React, { useEffect, useRef, useState } from 'react';

const { Title, Text, Paragraph } = Typography;

export default function RtcAgentDiagnosePage() {
  const intl = useIntl();
  const { message } = App.useApp();
  const [status, setStatus] = useState<'checking' | 'success'>('checking');
  const [agentFound, setAgentFound] = useState(false);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Normal hook call (cannot wrap Hooks in try-catch)
  const modelState = useModel('@@initialState');

  useEffect(() => {
    // Check if RTC Agent is mounted
    const checkAgent = () => {
      const agent = document.querySelector('rtc-agent');
      if (agent) {
        setAgentFound(true);
        if (status === 'checking') {
          setStatus('success');
        }
      } else {
        setAgentFound(false);
        if (status === 'checking') {
          // Check again after 2 seconds
          checkTimerRef.current = setTimeout(() => {
            const agent2 = document.querySelector('rtc-agent');
            if (agent2) {
              setAgentFound(true);
              setStatus('success');
            }
            // Note: If agent is still not found after 2 seconds, keep 'checking' status
            // This allows users to see diagnosis info and test manually
            checkTimerRef.current = null;
          }, 2000);
        }
      }
    };

    checkAgent();

    return () => {
      if (checkTimerRef.current) {
        clearTimeout(checkTimerRef.current);
      }
      if (destroyTimerRef.current) {
        clearTimeout(destroyTimerRef.current);
      }
    };
  }, [status]);

  const handleTestDynamicImport = async () => {
    // Prevent double-mount
    if (document.querySelector('rtc-agent[data-diagnose-agent="true"]')) {
      message.warning(
        intl.formatMessage({ id: 'pages.diagnose.agentAlreadyRunning' }),
      );
      return;
    }

    try {
      message.loading(
        intl.formatMessage({ id: 'pages.diagnose.testingDynamicImport' }),
        0,
      );
      const { createRtcAgent } = await import('@rtc-agent/component');

      const testAgent = createRtcAgent({
        appLabel: 'Test Agent',
        server: { url: window.location.origin },
        workerURL: '/rtc-agent/shared-worker.js',
        databaseName: 'admin-ui-diagnose',
        window: { defaultMode: 'minimized' },
      });

      // Mark as diagnose agent for identification
      testAgent.setAttribute('data-diagnose-agent', 'true');
      document.body.appendChild(testAgent);
      message.success(
        intl.formatMessage({ id: 'pages.diagnose.dynamicImportSuccess' }),
      );

      destroyTimerRef.current = setTimeout(() => {
        try {
          testAgent.destroy();
          message.info(
            intl.formatMessage({ id: 'pages.diagnose.testAgentDestroyed' }),
          );
        } catch (e) {
          console.warn('Failed to destroy diagnose agent:', e);
        }
        destroyTimerRef.current = null;
      }, 3000);
    } catch (e) {
      message.error(
        intl.formatMessage(
          { id: 'pages.diagnose.dynamicImportFailed' },
          { error: e instanceof Error ? e.message : String(e) },
        ),
      );
    }
  };

  return (
    <PageContainer>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Title level={2}>
            {intl.formatMessage({ id: 'pages.diagnose.title' })}
          </Title>

          {status === 'success' && (
            <Alert
              type="success"
              showIcon
              message={intl.formatMessage({
                id: 'pages.diagnose.integrationNormal',
              })}
              description={
                agentFound
                  ? intl.formatMessage({ id: 'pages.diagnose.agentMounted' })
                  : intl.formatMessage({ id: 'pages.diagnose.agentNotMounted' })
              }
            />
          )}

          <Card
            title={intl.formatMessage({ id: 'pages.diagnose.diagnosticInfo' })}
          >
            <Space direction="vertical">
              <div>
                <Text strong>
                  {intl.formatMessage({
                    id: 'pages.diagnose.useModelStatus',
                  })}{' '}
                </Text>
                <Text code>
                  {modelState
                    ? intl.formatMessage({ id: 'pages.diagnose.statusNormal' })
                    : intl.formatMessage({
                        id: 'pages.diagnose.statusAbnormal',
                      })}
                </Text>
              </div>
              <div>
                <Text strong>
                  {intl.formatMessage({
                    id: 'pages.diagnose.rtcAgentElement',
                  })}{' '}
                </Text>
                <Text code>
                  {agentFound
                    ? intl.formatMessage({ id: 'pages.diagnose.found' })
                    : intl.formatMessage({ id: 'pages.diagnose.notFound' })}
                </Text>
              </div>
              <div>
                <Text strong>
                  {intl.formatMessage({
                    id: 'pages.diagnose.loginStatus',
                  })}{' '}
                </Text>
                <Text code>
                  {modelState?.initialState?.currentUser
                    ? intl.formatMessage({ id: 'pages.diagnose.loggedIn' })
                    : intl.formatMessage({ id: 'pages.diagnose.notLoggedIn' })}
                </Text>
              </div>
            </Space>
          </Card>

          <Card title={intl.formatMessage({ id: 'pages.diagnose.testTools' })}>
            <Space>
              <Button type="primary" onClick={handleTestDynamicImport}>
                {intl.formatMessage({ id: 'pages.diagnose.testDynamicImport' })}
              </Button>
              <Button onClick={() => window.location.reload()}>
                {intl.formatMessage({ id: 'pages.diagnose.reloadPage' })}
              </Button>
            </Space>
          </Card>

          <Card
            title={intl.formatMessage({ id: 'pages.diagnose.instructions' })}
          >
            <Paragraph>
              {intl.formatMessage({ id: 'pages.diagnose.consoleErrorHint' })}
            </Paragraph>
            <Paragraph code>
              TypeError: Cannot destructure property 'dispatcher' of
              'useContext(...)' as it is null
            </Paragraph>
            <Paragraph>
              {intl.formatMessage({ id: 'pages.diagnose.pleaseCheck' })}
              <ul>
                <li>
                  {intl.formatMessage({ id: 'pages.diagnose.checkClearCache' })}
                </li>
                <li>
                  {intl.formatMessage({
                    id: 'pages.diagnose.checkRestartServer',
                  })}
                </li>
                <li>
                  {intl.formatMessage({
                    id: 'pages.diagnose.checkConsoleStack',
                  })}
                </li>
              </ul>
            </Paragraph>
          </Card>
        </Space>
      </Card>
    </PageContainer>
  );
}
