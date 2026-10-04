/**
 * RTC Agent 集成诊断页面
 *
 * 此页面用于诊断 RTC Agent 集成是否正常工作。
 */

import { PageContainer } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Alert, Button, Card, message, Space, Typography } from 'antd';
import React, { useEffect, useRef, useState } from 'react';

const { Title, Text, Paragraph } = Typography;

export default function RtcAgentDiagnosePage() {
  const [status, setStatus] = useState<'checking' | 'success'>('checking');
  const [agentFound, setAgentFound] = useState(false);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 正常调用 useModel（不能在 try-catch 中调用 Hooks）
  const modelState = useModel('@@initialState');

  useEffect(() => {
    // 检查 RTC Agent 是否已挂载
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
          // 等待 2 秒后再检查
          checkTimerRef.current = setTimeout(() => {
            const agent2 = document.querySelector('rtc-agent');
            if (agent2) {
              setAgentFound(true);
              setStatus('success');
            }
            // 注意：如果 2 秒后仍然没有找到 agent，保持 'checking' 状态
            // 这样用户可以看到诊断信息并手动测试
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
      message.warning('诊断 agent 已在运行中');
      return;
    }

    try {
      message.loading('正在测试动态导入...', 0);
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
      message.success('动态导入成功，测试 agent 已挂载');

      destroyTimerRef.current = setTimeout(() => {
        try {
          testAgent.destroy();
          message.info('测试 agent 已销毁');
        } catch (e) {
          console.warn('Failed to destroy diagnose agent:', e);
        }
        destroyTimerRef.current = null;
      }, 3000);
    } catch (e) {
      message.error(
        `动态导入失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <PageContainer>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Title level={2}>RTC Agent 集成诊断</Title>

          {status === 'success' && (
            <Alert
              type="success"
              showIcon
              message="集成正常"
              description={
                agentFound
                  ? 'RTC Agent 已成功挂载到页面'
                  : 'RTC Agent 未挂载（这可能是因为您未登录）'
              }
            />
          )}

          <Card title="诊断信息">
            <Space direction="vertical">
              <div>
                <Text strong>useModel 状态: </Text>
                <Text code>{modelState ? '正常' : '异常'}</Text>
              </div>
              <div>
                <Text strong>RTC Agent 元素: </Text>
                <Text code>{agentFound ? '已找到' : '未找到'}</Text>
              </div>
              <div>
                <Text strong>登录状态: </Text>
                <Text code>
                  {modelState?.initialState?.currentUser ? '已登录' : '未登录'}
                </Text>
              </div>
            </Space>
          </Card>

          <Card title="测试工具">
            <Space>
              <Button type="primary" onClick={handleTestDynamicImport}>
                测试动态导入
              </Button>
              <Button onClick={() => window.location.reload()}>刷新页面</Button>
            </Space>
          </Card>

          <Card title="说明">
            <Paragraph>如果在浏览器控制台看到以下错误：</Paragraph>
            <Paragraph code>
              TypeError: Cannot destructure property 'dispatcher' of
              'useContext(...)' as it is null
            </Paragraph>
            <Paragraph>
              请检查：
              <ul>
                <li>是否清除了浏览器缓存（Cmd+Shift+R / Ctrl+Shift+R）</li>
                <li>是否重启了开发服务器</li>
                <li>检查浏览器控制台的完整错误堆栈</li>
              </ul>
            </Paragraph>
          </Card>
        </Space>
      </Card>
    </PageContainer>
  );
}
