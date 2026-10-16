/**
 * RTC Agent Integration Diagnosis Page
 *
 * This page is used to diagnose whether RTC Agent integration is working properly.
 */

import { PageContainer } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { useIntl, useModel } from '@umijs/max';
import { Alert, App, Button, Card, Space, Typography } from 'antd';
import { useEffect, useRef } from 'react';
import { queryKeys } from '@/utils/queryKeys';

const { Title, Text, Paragraph } = Typography;

export default function RtcAgentDiagnosePage() {
  const intl = useIntl();
  const { message } = App.useApp();
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      if (destroyTimerRef.current) {
        clearTimeout(destroyTimerRef.current);
        destroyTimerRef.current = null;
      }
    };
  }, []);

  // Normal hook call (cannot wrap Hooks in try-catch)
  const modelState = useModel('@@initialState');

  // 使用 useQuery 轮询检查 RTC Agent 是否挂载
  const { data: agentStatus } = useQuery({
    queryKey: queryKeys.diagnostics.agentStatus(),
    queryFn: () => {
      const agent = document.querySelector('rtc-agent');
      return { found: agent !== null };
    },
    refetchInterval: 2000,
    staleTime: 0,
  });

  const status = agentStatus?.found ? 'success' : 'checking';
  const agentFound = agentStatus?.found ?? false;

  const handleTestDynamicImport = async () => {
    // Prevent double-mount
    if (document.querySelector('rtc-agent[data-diagnose-agent="true"]')) {
      message.warning(
        intl.formatMessage({
          id: 'pages.diagnose.agentAlreadyRunning',
          defaultMessage: 'Diagnose agent is already running',
        }),
      );
      return;
    }

    try {
      message.loading(
        intl.formatMessage({
          id: 'pages.diagnose.testingDynamicImport',
          defaultMessage: 'Testing dynamic import...',
        }),
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
        intl.formatMessage({
          id: 'pages.diagnose.dynamicImportSuccess',
          defaultMessage: 'Dynamic import successful, test agent mounted',
        }),
      );

      destroyTimerRef.current = setTimeout(() => {
        try {
          testAgent.destroy();
          message.info(
            intl.formatMessage({
              id: 'pages.diagnose.testAgentDestroyed',
              defaultMessage: 'Test agent destroyed',
            }),
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
          {
            error: e instanceof Error ? e.message : String(e),
            defaultMessage: 'Dynamic import failed: {error}',
          },
        ),
      );
    }
  };

  return (
    <PageContainer>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Title level={2}>
            {intl.formatMessage({
              id: 'pages.diagnose.title',
              defaultMessage: 'RTC Agent Integration Diagnosis',
            })}
          </Title>

          {status === 'success' && (
            <Alert
              type="success"
              showIcon
              message={intl.formatMessage({
                id: 'pages.diagnose.integrationNormal',
                defaultMessage: 'Integration Normal',
              })}
              description={
                agentFound
                  ? intl.formatMessage({
                      id: 'pages.diagnose.agentMounted',
                      defaultMessage:
                        'RTC Agent has been successfully mounted to the page',
                    })
                  : intl.formatMessage({
                      id: 'pages.diagnose.agentNotMounted',
                      defaultMessage:
                        'RTC Agent is not mounted (this may be because you are not logged in)',
                    })
              }
            />
          )}

          <Card
            title={intl.formatMessage({
              id: 'pages.diagnose.diagnosticInfo',
              defaultMessage: 'Diagnostic Info',
            })}
          >
            <Space direction="vertical">
              <div>
                <Text strong>
                  {intl.formatMessage({
                    id: 'pages.diagnose.useModelStatus',
                    defaultMessage: 'useModel Status:',
                  })}{' '}
                </Text>
                <Text code>
                  {modelState
                    ? intl.formatMessage({
                        id: 'pages.diagnose.statusNormal',
                        defaultMessage: 'Normal',
                      })
                    : intl.formatMessage({
                        id: 'pages.diagnose.statusAbnormal',
                        defaultMessage: 'Abnormal',
                      })}
                </Text>
              </div>
              <div>
                <Text strong>
                  {intl.formatMessage({
                    id: 'pages.diagnose.rtcAgentElement',
                    defaultMessage: 'RTC Agent Element:',
                  })}{' '}
                </Text>
                <Text code>
                  {agentFound
                    ? intl.formatMessage({
                        id: 'pages.diagnose.found',
                        defaultMessage: 'Found',
                      })
                    : intl.formatMessage({
                        id: 'pages.diagnose.notFound',
                        defaultMessage: 'Not Found',
                      })}
                </Text>
              </div>
              <div>
                <Text strong>
                  {intl.formatMessage({
                    id: 'pages.diagnose.loginStatus',
                    defaultMessage: 'Login Status:',
                  })}{' '}
                </Text>
                <Text code>
                  {modelState?.initialState?.currentUser
                    ? intl.formatMessage({
                        id: 'pages.diagnose.loggedIn',
                        defaultMessage: 'Logged In',
                      })
                    : intl.formatMessage({
                        id: 'pages.diagnose.notLoggedIn',
                        defaultMessage: 'Not Logged In',
                      })}
                </Text>
              </div>
            </Space>
          </Card>

          <Card
            title={intl.formatMessage({
              id: 'pages.diagnose.testTools',
              defaultMessage: 'Test Tools',
            })}
          >
            <Space>
              <Button type="primary" onClick={handleTestDynamicImport}>
                {intl.formatMessage({
                  id: 'pages.diagnose.testDynamicImport',
                  defaultMessage: 'Test Dynamic Import',
                })}
              </Button>
              <Button onClick={() => window.location.reload()}>
                {intl.formatMessage({
                  id: 'pages.diagnose.reloadPage',
                  defaultMessage: 'Reload Page',
                })}
              </Button>
            </Space>
          </Card>

          <Card
            title={intl.formatMessage({
              id: 'pages.diagnose.instructions',
              defaultMessage: 'Instructions',
            })}
          >
            <Paragraph>
              {intl.formatMessage({
                id: 'pages.diagnose.consoleErrorHint',
                defaultMessage:
                  'If you see the following error in the browser console:',
              })}
            </Paragraph>
            <Paragraph code>
              TypeError: Cannot destructure property 'dispatcher' of
              'useContext(...)' as it is null
            </Paragraph>
            <Paragraph>
              {intl.formatMessage({
                id: 'pages.diagnose.pleaseCheck',
                defaultMessage: 'Please check:',
              })}
              <ul>
                <li>
                  {intl.formatMessage({
                    id: 'pages.diagnose.checkClearCache',
                    defaultMessage:
                      'Have you cleared browser cache (Cmd+Shift+R / Ctrl+Shift+R)',
                  })}
                </li>
                <li>
                  {intl.formatMessage({
                    id: 'pages.diagnose.checkRestartServer',
                    defaultMessage: 'Have you restarted the development server',
                  })}
                </li>
                <li>
                  {intl.formatMessage({
                    id: 'pages.diagnose.checkConsoleStack',
                    defaultMessage:
                      'Check the full error stack in browser console',
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
