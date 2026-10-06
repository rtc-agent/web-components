import XMarkdown from '@ant-design/x-markdown';
import { useIntl } from '@umijs/max';
import {
  Alert,
  Card,
  Collapse,
  Descriptions,
  Drawer,
  Space,
  Tag,
  Typography,
} from 'antd';
import React, { useMemo } from 'react';
import type { MessageInfo } from '../data';

const { Text } = Typography;

/* ── ContentData Types (mirrors @rtc-agent/protocol) ── */

/** Parsed content data shape from the server's JSON content field. */
interface ContentData {
  type: ContentType;
  data: unknown;
}

type ContentType =
  | 'text'
  | 'markdown'
  | 'thinking'
  | 'toolcall_input'
  | 'toolcall_output'
  | 'user_message'
  | 'error'
  | 'prompt'
  | 'summary';

interface ToolCallData {
  id: string;
  tool_name: string;
  input: string;
  output?: string;
  status?: string;
}

interface UserMessageContent {
  text: string;
  files?: Array<{
    mimetype: string;
    fileid: string;
    extra?: Record<string, unknown>;
  }>;
  scenarios?: Array<{ title: string; filepath: string; file_content: string }>;
}

interface ErrorContent {
  category: string;
  title: string;
  message: string;
  retryable: boolean;
  raw_error?: string;
  show_raw_error?: boolean;
}

interface PromptContent {
  name: string;
  title?: string;
  prompt: string;
}

/* ── Parsing Helpers ── */

/**
 * Parse the content string from the API into a structured ContentData object.
 *
 * The server stores content as a JSON string: '{"type":"text","data":"hello"}'.
 * Handles backward compatibility: if the content is not valid JSON or doesn't
 * have a `type` field, treats it as plain markdown text.
 */
function parseContentData(raw: string | null | undefined): ContentData | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type && typeof parsed.type === 'string') {
      return parsed as ContentData;
    }
  } catch {
    // Not JSON — treat as plain text
  }

  // Fallback: treat as plain markdown
  return { type: 'text', data: raw };
}

/** Try to parse a JSON string; return the original string on failure. */
function tryFormatJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

/** Parse tool call input params for display in the header. */
function parseToolInput(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Format tool call header with name + relevant parameter. */
function formatToolHeader(toolName: string, input: string): string {
  const params = parseToolInput(input);

  switch (toolName) {
    case 'script': {
      const title = (params.title as string) || '';
      return title ? `script ${title}` : 'script';
    }
    case 'read':
      return `read ${(params.path as string) || ''}`;
    case 'ls':
      return `ls ${(params.path as string) || '/'}`;
    case 'write':
      return `write ${(params.path as string) || ''}`;
    case 'grep':
      return `grep ${(params.pattern as string) || ''}`;
    case 'find':
      return `find ${(params.pattern as string) || ''}`;
    case 'todoWrite': {
      const todos = params.todos as unknown[] | undefined;
      const count = Array.isArray(todos) ? todos.length : 0;
      return `todoWrite (${count} tasks)`;
    }
    default:
      return toolName;
  }
}

/** Parse todoWrite tool input into items. */
interface TodoItem {
  content: string;
  status: 'completed' | 'in_progress' | 'pending';
  active_form?: string;
}

function parseTodoWriteInput(input: string): TodoItem[] | null {
  try {
    const parsed = JSON.parse(input);
    const todos = parsed?.todos as TodoItem[] | undefined;
    return Array.isArray(todos) ? todos : null;
  } catch {
    return null;
  }
}

/** Parse script tool output data. */
interface ScriptOutputData {
  success: boolean;
  data?: {
    logs?: string[];
    warnings?: string[];
    errors?: string[];
    duration_ms?: number;
  };
  error?: string;
}

function parseScriptOutput(output: string): ScriptOutputData | null {
  try {
    let parsed = JSON.parse(output);
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    if ('success' in parsed) return parsed as ScriptOutputData;
    if ('logs' in parsed || 'duration_ms' in parsed) {
      return { success: true, data: parsed };
    }
    return null;
  } catch {
    return null;
  }
}

/* ── Content Renderers ── */

/** Render text/markdown content via XMarkdown. */
const TextContent: React.FC<{ data: unknown }> = ({ data }) => {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (!text) return <Text type="secondary">-</Text>;
  return (
    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
      <XMarkdown>{text}</XMarkdown>
    </div>
  );
};

/** Render thinking content as a collapsible block. */
const ThinkingContent: React.FC<{ data: unknown }> = ({ data }) => {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (!text) return <Text type="secondary">-</Text>;
  return (
    <Collapse
      size="small"
      items={[
        {
          key: '1',
          label: <Text type="secondary">思考过程</Text>,
          children: (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <XMarkdown>{text}</XMarkdown>
            </div>
          ),
        },
      ]}
    />
  );
};

/** Render a tool call input card. */
const ToolCallInputContent: React.FC<{ data: unknown }> = ({ data }) => {
  const tc = data as ToolCallData | undefined;
  if (!tc?.tool_name) {
    return (
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
        {tryFormatJson(data)}
      </pre>
    );
  }

  const header = formatToolHeader(tc.tool_name, tc.input);

  // Choose what to show in the body based on tool type
  let body: React.ReactNode;

  // read/ls/write/grep/find: header-only, no body
  if (['read', 'ls', 'write', 'grep', 'find'].includes(tc.tool_name)) {
    body = null;
  }
  // todoWrite: render as checklist
  else if (tc.tool_name === 'todoWrite') {
    const todos = parseTodoWriteInput(tc.input);
    if (todos && todos.length > 0) {
      body = (
        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
          {todos.map((todo) => {
            const icon =
              todo.status === 'completed'
                ? '✅'
                : todo.status === 'in_progress'
                  ? '🔄'
                  : '⬜';
            return (
              <div
                key={`todo-${todo.content.slice(0, 20)}`}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
              >
                <span>{icon}</span>
                <Text>{todo.content}</Text>
              </div>
            );
          })}
        </Space>
      );
    } else {
      body = (
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {tryFormatJson(tc.input)}
        </pre>
      );
    }
  }
  // script: show code
  else if (tc.tool_name === 'script') {
    try {
      const parsed = JSON.parse(tc.input);
      if (parsed.action === 'eval' || parsed.action === 'save') {
        body = (
          <Space orientation="vertical" size={4} style={{ width: '100%' }}>
            {parsed.name && (
              <div>
                <Text type="secondary">Name: </Text>
                <Text code>{parsed.name}</Text>
              </div>
            )}
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                margin: 0,
                maxHeight: 300,
                overflowY: 'auto',
              }}
            >
              {parsed.code || ''}
            </pre>
          </Space>
        );
      } else {
        body = (
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {tryFormatJson(tc.input)}
          </pre>
        );
      }
    } catch {
      body = (
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {tryFormatJson(tc.input)}
        </pre>
      );
    }
  }
  // Default: formatted JSON parameters
  else {
    const formatted = tryFormatJson(tc.input);
    if (formatted && formatted !== '{}' && formatted !== '""') {
      body = (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            margin: 0,
            maxHeight: 300,
            overflowY: 'auto',
            wordBreak: 'break-word',
          }}
        >
          {formatted}
        </pre>
      );
    } else {
      body = null;
    }
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <Tag color="geekblue">Tool Call</Tag>
          <Text strong>{header}</Text>
          {tc.status && <Tag>{tc.status}</Tag>}
        </Space>
      }
      styles={{ body: body ? {} : { padding: '8px 12px' } }}
    >
      {body}
    </Card>
  );
};

/** Render a tool call output card. */
const ToolCallOutputContent: React.FC<{ data: unknown }> = ({ data }) => {
  const tc = data as ToolCallData | undefined;
  if (!tc?.tool_name) {
    return (
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
        {tryFormatJson(data)}
      </pre>
    );
  }

  const header = formatToolHeader(tc.tool_name, tc.input || '');

  // todoWrite output: empty (input already shows the list)
  if (tc.tool_name === 'todoWrite') {
    return (
      <Card
        size="small"
        title={
          <Space>
            <Tag color="green">Tool Result</Tag>
            <Text>{header}</Text>
          </Space>
        }
      >
        <Text type="secondary">-</Text>
      </Card>
    );
  }

  // Script tool: structured output
  if (tc.tool_name === 'script' && tc.output) {
    const scriptOutput = parseScriptOutput(tc.output);
    if (scriptOutput) {
      const logs = scriptOutput.data?.logs || [];
      const warnings = scriptOutput.data?.warnings || [];
      const errors = scriptOutput.data?.errors || [];
      const duration = scriptOutput.data?.duration_ms;
      const isSuccess = scriptOutput.success !== false;

      return (
        <Card
          size="small"
          title={
            <Space>
              <Tag color={isSuccess ? 'green' : 'red'}>
                {isSuccess ? 'Tool Result' : 'Failed'}
              </Tag>
              <Text>{header}</Text>
              {duration != null && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {duration}ms
                </Text>
              )}
            </Space>
          }
        >
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {logs.length > 0 && (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  margin: '0 0 8px 0',
                  fontSize: 12,
                }}
              >
                {logs.join('\n')}
              </pre>
            )}
            {warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 8 }}
                title={warnings.map((w) => `[WARN] ${w}`).join('\n')}
              />
            )}
            {errors.length > 0 && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 8 }}
                title={errors.map((e) => `[ERR] ${e}`).join('\n')}
              />
            )}
            {scriptOutput.error && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 8 }}
                title={scriptOutput.error}
              />
            )}
            {logs.length === 0 &&
              warnings.length === 0 &&
              errors.length === 0 &&
              !scriptOutput.error && <Text type="secondary">(no output)</Text>}
          </div>
        </Card>
      );
    }
  }

  // Default: formatted output
  const outputFormatted = tryFormatJson(tc.output || '');
  return (
    <Card
      size="small"
      title={
        <Space>
          <Tag color="green">Tool Result</Tag>
          <Text>{header}</Text>
        </Space>
      }
    >
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          margin: 0,
          maxHeight: 400,
          overflowY: 'auto',
          wordBreak: 'break-word',
        }}
      >
        {outputFormatted || <Text type="secondary">-</Text>}
      </pre>
    </Card>
  );
};

/** Render error content. */
const ErrorContent: React.FC<{ data: unknown }> = ({ data }) => {
  const err = data as ErrorContent | undefined;
  if (!err?.title && !err?.message) {
    return (
      <Alert
        type="error"
        showIcon
        title="Error"
        description={tryFormatJson(data)}
      />
    );
  }

  const categoryColors: Record<string, string> = {
    api: 'blue',
    timeout: 'gold',
    system: 'red',
    context: 'orange',
    network: 'purple',
    permission: 'red',
    stream: 'default',
    tool: 'default',
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Alert
        type="error"
        showIcon
        title={
          <Space>
            <Text strong>{err.title || 'Error'}</Text>
            {err.category && (
              <Tag color={categoryColors[err.category] || 'default'}>
                {err.category}
              </Tag>
            )}
          </Space>
        }
        description={err.message}
      />
      {err.show_raw_error && err.raw_error && (
        <Collapse
          size="small"
          items={[
            {
              key: '1',
              label: <Text type="secondary">Raw Error</Text>,
              children: (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    margin: 0,
                    fontSize: 12,
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}
                >
                  {err.raw_error}
                </pre>
              ),
            },
          ]}
        />
      )}
    </Space>
  );
};

/** Render prompt content. */
const PromptContentView: React.FC<{ data: unknown }> = ({ data }) => {
  const pc = data as PromptContent | undefined;
  if (!pc) return <Text type="secondary">-</Text>;

  return (
    <Card
      size="small"
      title={
        <Space>
          <Tag color="cyan">{pc.name.toUpperCase()}</Tag>
          {pc.title && <Text strong>{pc.title}</Text>}
        </Space>
      }
    >
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          margin: 0,
          maxHeight: 400,
          overflowY: 'auto',
          fontSize: 12,
        }}
      >
        {pc.prompt}
      </pre>
    </Card>
  );
};

/** Render summary (context compression) content. */
const SummaryContent: React.FC<{ data: unknown }> = ({ data }) => {
  const content = data as Record<string, unknown> | undefined;
  const metadata = content?.metadata as Record<string, number> | undefined;

  const tokensBefore = metadata?.tokens_before || 0;
  const tokensAfter = metadata?.tokens_after || 0;
  const tokensSaved = tokensBefore - tokensAfter;
  const durationMs = metadata?.duration_ms || 0;

  return (
    <Tag color="default" style={{ padding: '4px 8px' }}>
      Compressed context
      {tokensSaved !== 0 && (
        <span
          style={{
            marginLeft: 4,
            color: tokensSaved > 0 ? '#52c41a' : '#faad14',
          }}
        >
          {tokensSaved > 0
            ? `released ${tokensSaved.toLocaleString()}`
            : `increased ${Math.abs(tokensSaved).toLocaleString()}`}{' '}
          tokens
        </span>
      )}
      {durationMs > 0 && (
        <span style={{ marginLeft: 4, color: '#8c8c8c' }}>{durationMs}ms</span>
      )}
    </Tag>
  );
};

/** Render user_message content (text + file attachments). */
const UserMessageContentView: React.FC<{ data: unknown }> = ({ data }) => {
  const userData = data as UserMessageContent | undefined;
  if (!userData) return <Text type="secondary">-</Text>;

  const text = userData.text || '';
  const files = userData.files || [];
  const scenarios = userData.scenarios || [];

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {scenarios.length > 0 && (
        <Space wrap>
          {scenarios.map((s) => (
            <Tag key={s.filepath || s.title} color="blue">
              #{s.title}
            </Tag>
          ))}
        </Space>
      )}
      {text && (
        <div style={{ maxHeight: 500, overflowY: 'auto' }}>
          <XMarkdown>{text}</XMarkdown>
        </div>
      )}
      {files.length > 0 && (
        <Space wrap>
          {files.map((f) => (
            <Tag key={f.fileid}>
              {(f.extra?.filename as string) || f.fileid} ({f.mimetype})
            </Tag>
          ))}
        </Space>
      )}
    </Space>
  );
};

/** Dispatch rendering based on content type. */
const ContentRenderer: React.FC<{ content: ContentData | null }> = ({
  content,
}) => {
  if (!content) return <Text type="secondary">-</Text>;

  switch (content.type) {
    case 'text':
    case 'markdown':
      return <TextContent data={content.data} />;

    case 'thinking':
      return <ThinkingContent data={content.data} />;

    case 'toolcall_input':
      return <ToolCallInputContent data={content.data} />;

    case 'toolcall_output':
      return <ToolCallOutputContent data={content.data} />;

    case 'error':
      return <ErrorContent data={content.data} />;

    case 'prompt':
      return <PromptContentView data={content.data} />;

    case 'summary':
      return <SummaryContent data={content.data} />;

    case 'user_message':
      return <UserMessageContentView data={content.data} />;

    default:
      // Unknown type: try to render data as text/markdown
      return <TextContent data={content.data} />;
  }
};

/* ── Main Component ── */

/** 格式化 Token 数字：null 时显示 '-'，否则千分位 */
const formatTokens = (value: number | null): string =>
  value !== null ? value.toLocaleString() : '-';

/** 格式化时间戳 */
const formatDateTime = (value: string): string => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

type MessageDetailDrawerProps = {
  open: boolean;
  message: MessageInfo | null;
  onClose: () => void;
};

/**
 * 消息详情 Drawer
 *
 * Parses the content JSON string into a ContentData object and renders
 * it with type-specific components matching the chatbot page's rendering:
 * - text/markdown → XMarkdown
 * - thinking → collapsible block
 * - toolcall_input → tool call card
 * - toolcall_output → tool result card
 * - error → alert with details
 * - prompt → bordered card
 * - summary → compressed context tag
 * - user_message → text + files + scenarios
 */
const MessageDetailDrawer: React.FC<MessageDetailDrawerProps> = ({
  open,
  message: msg,
  onClose,
}) => {
  const intl = useIntl();

  const titleSuffix = msg ? ` - ${msg.id.slice(0, 8)}` : '';

  // Parse content JSON string into structured ContentData
  const contentData = useMemo(
    () => parseContentData(msg?.content),
    [msg?.content],
  );

  return (
    <Drawer
      title={`${intl.formatMessage({
        id: 'pages.messages.detail.title',
        defaultMessage: '消息详情',
      })}${titleSuffix}`}
      open={open}
      onClose={onClose}
      size={640}
      destroyOnHidden
    >
      {msg && (
        <>
          <Descriptions
            column={1}
            bordered
            size="small"
            style={{ marginBottom: 16 }}
          >
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.messages.sessionId',
                defaultMessage: 'Session ID',
              })}
            >
              <Text copyable={{ text: msg.session_id }}>{msg.session_id}</Text>
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.messages.role',
                defaultMessage: '角色',
              })}
            >
              <Tag color={msg.role === 'user' ? 'blue' : 'green'}>
                {msg.role}
              </Tag>
              {contentData?.type && (
                <Tag style={{ marginLeft: 4 }}>{contentData.type}</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.messages.inputTokens',
                defaultMessage: '输入 Tokens',
              })}
            >
              {formatTokens(msg.input_tokens)}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.messages.outputTokens',
                defaultMessage: '输出 Tokens',
              })}
            >
              {formatTokens(msg.output_tokens)}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.messages.totalTokens',
                defaultMessage: '总 Tokens',
              })}
            >
              {formatTokens(msg.total_tokens)}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.messages.createdAt',
                defaultMessage: '创建时间',
              })}
            >
              {formatDateTime(msg.created_at)}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.messages.globalOffset',
                defaultMessage: 'Global Offset',
              })}
            >
              {msg.global_offset}
            </Descriptions.Item>
          </Descriptions>

          <Card
            size="small"
            title={intl.formatMessage({
              id: 'pages.messages.content',
              defaultMessage: '内容',
            })}
          >
            <ContentRenderer content={contentData} />
          </Card>
        </>
      )}
    </Drawer>
  );
};

export default MessageDetailDrawer;
