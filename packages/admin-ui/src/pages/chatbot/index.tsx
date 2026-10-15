import { MenuOutlined, UserOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Bubble, Conversations, Sender, Think, XProvider } from '@ant-design/x';
import type {
  BubbleItemType,
  BubbleListProps,
} from '@ant-design/x/es/bubble/interface';
import XMarkdown from '@ant-design/x-markdown';
import { useXChat } from '@ant-design/x-sdk';
import { useIntl } from '@umijs/max';
import { Avatar, Button, Card } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import type { ConversationItem, ParsedMessage } from './data';
import type { ChatbotPageAPI } from './page-api';
import { PRESET_SESSIONS } from './preset-sessions';
import { createChatProvider } from './service';
import { useStyles } from './style';

// WELCOME_TEXT is used for typewriter animation, kept as constant
const WELCOME_TEXT_KEY = 'pages.chatbot.welcomeText';
const TYPEWRITER_INTERVAL_MS = 80;

const TypewriterTitle: React.FC<{ text: string }> = ({ text }) => {
  const { styles } = useStyles();
  const [index, setIndex] = useState(0);
  const done = index >= text.length;

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= text.length) {
          clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, TYPEWRITER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [text]);

  return (
    <>
      {text.slice(0, index)}
      {!done && <span className={styles.cursor}>|</span>}
    </>
  );
};

const parser = (message: { content: string; role: string }): ParsedMessage => {
  const { content, role } = message;
  if (role !== 'assistant') return { role: 'user', content };

  const trimmed = content.trimStart();

  const fullMatch = trimmed.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/);
  if (fullMatch) {
    return {
      role: 'assistant',
      thinkContent: fullMatch[1],
      content: fullMatch[2].trimStart(),
    };
  }

  const partialMatch = trimmed.match(/^<think>([\s\S]*)$/);
  if (partialMatch) {
    return { role: 'assistant', thinkContent: partialMatch[1], content: '' };
  }

  return { role: 'assistant', content };
};

const STREAMING_ACTIVE = { hasNextChunk: true, enableAnimation: true };
const STREAMING_IDLE = { hasNextChunk: false, enableAnimation: true };

const createRoleConfig = (aiAvatarStyle: string): BubbleListProps['role'] => ({
  user: {
    placement: 'end',
    avatar: <Avatar icon={<UserOutlined />} />,
  },
  ai: {
    placement: 'start',
    avatar: (
      <Avatar className={aiAvatarStyle}>
        🤖
      </Avatar>
    ),
    typing: { effect: 'typing', step: 2, interval: 20 },
    contentRender: (
      content: string,
      info: { status?: string; loading?: boolean },
    ) => {
      if (info?.loading || !content) return undefined;
      return (
        <XMarkdown
          streaming={
            info?.status === 'updating' ? STREAMING_ACTIVE : STREAMING_IDLE
          }
        >
          {content}
        </XMarkdown>
      );
    },
  },
});

const ChatbotPage: React.FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const idCounter = useRef(0);
  const generateId = useCallback(() => `conv-${++idCounter.current}`, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const roleConfig = useMemo(() => createRoleConfig(styles.aiAvatar), [styles.aiAvatar]);

  const welcomeText = intl.formatMessage({
    id: WELCOME_TEXT_KEY,
    defaultMessage: '🤖 Hello, how can I help you?',
  });

  const initialConversations = useMemo<ConversationItem[]>(
    () => [
      {
        key: 'default',
        label: intl.formatMessage({
          id: 'pages.chatbot.newConversation',
          defaultMessage: '💬 New conversation',
        }),
        group: intl.formatMessage({
          id: 'pages.chatbot.today',
          defaultMessage: 'Today',
        }),
        isDraft: true,
      },
      ...PRESET_SESSIONS.map((preset) => ({
        key: preset.id,
        label: intl.formatMessage({
          id: preset.titleKey,
          defaultMessage: preset.titleKey,
        }),
        group: intl.formatMessage({
          id: preset.groupKey,
          defaultMessage: preset.groupKey,
        }),
      })),
    ],
    [intl],
  );

  const [conversations, setConversations] =
    useState<ConversationItem[]>(initialConversations);
  const [activeKey, setActiveKey] = useState<string>('default');
  const [inputValue, setInputValue] = useState('');

  const provider = useMemo(() => createChatProvider(), []);

  const { onRequest, abort, isRequesting, parsedMessages } = useXChat<
    any,
    ParsedMessage
  >({
    provider: provider as any,
    conversationKey: activeKey,
    parser,
    requestPlaceholder: { role: 'assistant', content: '' },
  });

  const sendMessage = (content: string) => {
    setInputValue('');
    setConversations((prev) =>
      prev.map((c) =>
        c.key === activeKey && c.isDraft
          ? { ...c, label: content.slice(0, 20), isDraft: false }
          : c,
      ),
    );
    onRequest({ messages: [{ role: 'user', content }] });
  };

  const newChat = () => {
    const key = generateId();
    setConversations((prev) => [
      {
        key,
        label: intl.formatMessage({
          id: 'pages.chatbot.newConversationLabel',
          defaultMessage: 'New conversation',
        }),
        group: intl.formatMessage({
          id: 'pages.chatbot.today',
          defaultMessage: 'Today',
        }),
        isDraft: true,
      },
      ...prev,
    ]);
    setActiveKey(key);
  };

  // Refs to expose current values/functions to Page API factory
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const parsedMessagesRef = useRef(parsedMessages);
  parsedMessagesRef.current = parsedMessages;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const setConversationsRef = useRef(setConversations);
  setConversationsRef.current = setConversations;
  const setActiveKeyRef = useRef(setActiveKey);
  setActiveKeyRef.current = setActiveKey;
  const generateIdRef = useRef(generateId);
  generateIdRef.current = generateId;
  const intlRef = useRef(intl);
  intlRef.current = intl;

  // Register Page API for function handlers
  usePageAPIRegistration(
    'chatbot',
    useCallback(
      (): ChatbotPageAPI => ({
        sendMessage: async (content: string) => {
          try {
            sendMessageRef.current(content);
            return { success: true };
          } catch (error) {
            console.error('[ChatbotPageAPI] sendMessage failed:', {
              contentLength: content?.length,
              error,
            });
            return { success: false };
          }
        },
        getMessages: async () => {
          return {
            success: true,
            data: parsedMessagesRef.current.map(
              (msg) => msg.message as ParsedMessage,
            ),
          };
        },
        clearConversation: async () => {
          const oldKey = activeKeyRef.current;
          try {
            // Replace active conversation with a fresh one (same semantics as "new chat"
            // followed by deleting the old one) so the chat history is reset.
            const newKey = generateIdRef.current();
            setConversationsRef.current((prev) => {
              const filtered = prev.filter((c) => c.key !== oldKey);
              return [
                {
                  key: newKey,
                  label: intlRef.current.formatMessage({
                    id: 'pages.chatbot.newConversation',
                    defaultMessage: '💬 New conversation',
                  }),
                  group: intlRef.current.formatMessage({
                    id: 'pages.chatbot.today',
                    defaultMessage: 'Today',
                  }),
                  isDraft: true,
                },
                ...filtered,
              ];
            });
            setActiveKeyRef.current(newKey);
            return { success: true };
          } catch (error) {
            console.error('[ChatbotPageAPI] clearConversation failed:', {
              oldKey,
              error,
            });
            return { success: false };
          }
        },
        newChat: async () => {
          try {
            const key = generateIdRef.current();
            setConversationsRef.current((prev) => [
              {
                key,
                label: intlRef.current.formatMessage({
                  id: 'pages.chatbot.newConversationLabel',
                  defaultMessage: 'New conversation',
                }),
                group: intlRef.current.formatMessage({
                  id: 'pages.chatbot.today',
                  defaultMessage: 'Today',
                }),
                isDraft: true,
              },
              ...prev,
            ]);
            setActiveKeyRef.current(key);
            return { success: true, conversationKey: key };
          } catch (error) {
            console.error('[ChatbotPageAPI] newChat failed:', { error });
            return { success: false, conversationKey: '' };
          }
        },
      }),
      [],
    ),
  );

  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      parsedMessages.map((msg) => {
        const parsed = msg.message as ParsedMessage;
        const isAI = parsed.role === 'assistant';
        const thinkContent =
          parsed.role === 'assistant' ? parsed.thinkContent : undefined;

        const item: BubbleItemType = {
          key: msg.id,
          role: isAI ? 'ai' : 'user',
          content: parsed.content,
          loading: isAI && msg.status === 'loading',
          status: msg.status,
        };

        if (isAI && thinkContent) {
          item.header = <Think>{thinkContent}</Think>;
        }

        return item;
      }),
    [parsedMessages],
  );

  const hasMessages = parsedMessages.length > 0;

  // Handle missing configuration gracefully
  if (!provider) {
    return (
      <PageContainer>
        <Card
          style={{
            height: 'calc(100vh - 160px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h3>
              {intl.formatMessage({
                id: 'pages.chatbot.notAvailable',
                defaultMessage: 'Chatbot is not available',
              })}
            </h3>
            <p>
              {intl.formatMessage({
                id: 'pages.chatbot.notConfigured',
                defaultMessage:
                  'Please configure CHAT_API_URL environment variable',
              })}
            </p>
          </div>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      ghost
      childrenContentStyle={{
        paddingBlock: 0,
        height: 'calc(100vh - 160px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Card
        variant="borderless"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        styles={{
          body: {
            flex: 1,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <XProvider>
          <div className={styles.layout}>
            <Button
              className={styles.mobileMenuButton}
              icon={<MenuOutlined />}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle sidebar"
            />
            <div className={`${styles.sidebar} ${sidebarOpen ? 'open' : ''}`}>
              <Conversations
                items={conversations}
                activeKey={activeKey}
                onActiveChange={setActiveKey}
                groupable
                menu={(conversation) => ({
                  items: [
                    {
                      key: 'delete',
                      label: intl.formatMessage({
                        id: 'pages.chatbot.delete',
                        defaultMessage: 'Delete',
                      }),
                      danger: true,
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'delete') {
                      setConversations((prev) => {
                        const next = prev.filter(
                          (c) => c.key !== conversation.key,
                        );
                        if (next.length === 0) {
                          const key = generateId();
                          next.push({
                            key,
                            label: intl.formatMessage({
                              id: 'pages.chatbot.newConversation',
                              defaultMessage: '💬 New conversation',
                            }),
                            group: intl.formatMessage({
                              id: 'pages.chatbot.today',
                              defaultMessage: 'Today',
                            }),
                            isDraft: true,
                          });
                          setActiveKey(key);
                        } else if (activeKey === conversation.key) {
                          setActiveKey(next[0]?.key ?? '');
                        }
                        return next;
                      });
                    }
                  },
                })}
                creation={{
                  onClick: newChat,
                  label: intl.formatMessage({
                    id: 'pages.chatbot.createConversation',
                    defaultMessage: 'New conversation',
                  }),
                }}
              />
            </div>

            <div className={styles.main}>
              {hasMessages && (
                <div className={styles.messages}>
                  <Bubble.List
                    items={bubbleItems}
                    role={roleConfig}
                    autoScroll
                    styles={{ root: { width: '100%' } }}
                    className={styles.messageContainer}
                  />
                </div>
              )}

              <div
                className={hasMessages ? styles.footer : styles.footerCenter}
              >
                {!hasMessages && (
                  <div className={styles.welcomeTitle}>
                    <TypewriterTitle text={welcomeText} />
                  </div>
                )}
                <Sender
                  value={inputValue}
                  onChange={setInputValue}
                  loading={isRequesting}
                  onSubmit={sendMessage}
                  onCancel={abort}
                  placeholder={intl.formatMessage({
                    id: 'pages.chatbot.inputPlaceholder',
                    defaultMessage: 'Type a message, press Enter to send...',
                  })}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  className={styles.messageContainer}
                  styles={{ input: { paddingBlock: 0 } }}
                />
              </div>
            </div>
          </div>
        </XProvider>
      </Card>
    </PageContainer>
  );
};

export default ChatbotPage;
