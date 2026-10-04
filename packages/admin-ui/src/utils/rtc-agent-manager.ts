/**
 * RTC Agent 全局管理器
 *
 * 这是一个纯 JavaScript 模块，不依赖 React。
 * 它监听登录状态的变化，并在适当的时候创建/销毁 Web Component。
 */

import type { RtcAgentWithLifecycle } from '@rtc-agent/component';
import { createAdminAuthProvider } from '@/utils/rtc-auth-provider';

// Web Component 实例（全局单例）
let rtcAgentInstance: RtcAgentWithLifecycle | null = null;

// 动态导入标记
let importPromise: Promise<{
  createRtcAgent: typeof import('@rtc-agent/component').createRtcAgent;
}> | null = null;

// 挂载状态标记（用于防止竞态条件）
let mountRequested = false;
let isMounting = false;

// RTC Agent Server URL
// 使用 process.env（构建时替换）而不是 window.env（运行时变量）
// 如果未配置，使用当前页面 origin（开发环境走 proxy，生产环境同源）
const RTC_AGENT_URL = process.env.RTC_AGENT_URL || window.location.origin;

function loadRtcAgentComponent() {
  if (!importPromise) {
    console.log('[RTC Agent Manager] Loading @rtc-agent/component...');
    importPromise = import('@rtc-agent/component')
      .then((module) => {
        console.log(
          '[RTC Agent Manager] @rtc-agent/component loaded successfully',
        );
        return module;
      })
      .catch((error) => {
        console.error(
          '[RTC Agent Manager] Failed to load @rtc-agent/component:',
          error,
        );
        importPromise = null;
        isMounting = false;
        throw error;
      });
  }
  return importPromise;
}

export function mountRtcAgent() {
  console.log('[RTC Agent Manager] mountRtcAgent called');

  // 防止重复挂载：已挂载或正在挂载中
  if (rtcAgentInstance) {
    console.warn('[RTC Agent Manager] RTC Agent already mounted');
    return;
  }
  if (isMounting) {
    console.warn('[RTC Agent Manager] RTC Agent mount already in progress');
    return;
  }

  // 标记需要挂载（防止竞态条件）
  mountRequested = true;
  isMounting = true;

  loadRtcAgentComponent()
    .then(({ createRtcAgent }) => {
      isMounting = false;

      // 检查是否在导入期间取消了挂载
      if (!mountRequested) {
        console.log(
          '[RTC Agent Manager] Mount was cancelled during import, skipping',
        );
        return;
      }

      // 再次检查是否已被其他并发调用挂载
      if (rtcAgentInstance) {
        console.warn(
          '[RTC Agent Manager] RTC Agent was mounted by another call, skipping',
        );
        return;
      }

      console.log('[RTC Agent Manager] Creating RTC Agent instance...');
      try {
        const agent = createRtcAgent({
          appLabel: 'RTC Agent',
          theme: 'system', // 主题模式：跟随系统
          server: { url: RTC_AGENT_URL },
          auth: createAdminAuthProvider(),
          workerURL: '/rtc-agent/shared-worker.js',
          databaseName: 'admin-ui',
          lang: 'zh-CN',
          window: {
            defaultMode: 'minimized',
            bubblePosition: {
              corner: 'bottom-right',
              offset: { x: -24, y: 24 },
            },
          },
          on: {
            ready: () => {
              console.log('[RTC Agent] Ready');
            },
            authLogin: ({ userId }: { userId: string }) => {
              console.log('[RTC Agent] Authenticated, userId:', userId);
            },
            authError: () => {
              console.error('[RTC Agent] Auth error, scheduling unmount');
              // Auth error indicates the token is invalid or expired.
              // Unmount the agent to prevent further errors.
              // Use setTimeout to defer unmount to next tick, avoiding issues
              // if this callback is called during component lifecycle.
              // The GlobalRtcAgent component will detect the auth state change
              // and remount when the user logs in again.
              setTimeout(() => {
                unmountRtcAgent();
              }, 0);
            },
          },
        });

        console.log('[RTC Agent Manager] Appending RTC Agent to document.body');
        document.body.appendChild(agent);
        rtcAgentInstance = agent;
        console.log('[RTC Agent Manager] RTC Agent mounted successfully');
      } catch (error) {
        console.error('[RTC Agent Manager] Failed to create RTC Agent:', error);
        // Reset state to allow retry if needed
        mountRequested = false;
        isMounting = false; // Fix: also reset isMounting to prevent permanent lock
      }
    })
    .catch((error) => {
      console.error(
        '[RTC Agent Manager] Failed to load @rtc-agent/component:',
        error,
      );
      // Reset state to allow retry if needed
      mountRequested = false;
      isMounting = false;
    });
}

export function unmountRtcAgent() {
  console.log('[RTC Agent Manager] unmountRtcAgent called');

  // 取消挂载请求（防止竞态条件）
  mountRequested = false;

  if (rtcAgentInstance) {
    console.log('[RTC Agent Manager] Destroying RTC Agent instance...');
    try {
      rtcAgentInstance.destroy();
      console.log('[RTC Agent Manager] RTC Agent destroyed successfully');
    } catch (e) {
      console.warn('[RTC Agent Manager] Failed to destroy RTC Agent:', e);
    }
    rtcAgentInstance = null;
  } else {
    console.log('[RTC Agent Manager] No RTC Agent instance to destroy');
  }
}
