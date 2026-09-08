/**
 * Notification Controller
 *
 * 轻量级通知系统：监听 UIUpdateBus 的新消息事件，根据焦点检测逻辑
 * 触发声音提示、Toast 通知和最小化图标动画。
 *
 * 架构：
 * - 订阅 UIUpdateBus 的 'message' 事件（按 entity 过滤）
 * - 通过 PersistenceLayer 查询消息所属 session
 * - 焦点检测：当前 session 收到消息不通知，其他 session 才通知
 * - 通知展示：正常模式 → Toast，最小化模式 → 图标动画
 *
 * Corresponds to: `NotificationContext` (defined in `contexts/notification.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: 需要感知未读通知的组件
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import {msg} from '@lit/localize';
import type {NotificationContextValue, NotificationState, NotificationActions} from '../contexts/notification.js';
import {DEFAULT_NOTIFICATION_STATE} from '../contexts/notification.js';
import type {SessionController} from './session.controller.js';
import type {MessageController} from './message.controller.js';
import type {ToastController} from './toast.controller.js';
import type {SettingsController} from './settings.controller.js';
import type {WindowStateController} from './window-state.controller.js';
import type {PersistenceLayer} from '@rtc-agent/persistence';
import {getUIUpdateBus} from '@rtc-agent/persistence';
import type {UIUpdateEvent} from '@rtc-agent/persistence';

// 音效资源 URL：Vite 的 `?url` 后缀在 dev/build 时都会解析为正确可访问的 URL
// （dev: dev server 路径；build: dist 下的 hashed 路径），无论组件部署在根路径、
// 子路径还是 CDN，都能正确加载。相比 `new URL('./', import.meta.url).pathname`
// 的旧方案：(1) 不会因 host 不匹配导致 404；(2) 不需要音效文件和脚本同目录。
import messageSoundUrl from '../assets/sounds/message.mp3?url';
import completeSoundUrl from '../assets/sounds/complete.mp3?url';
import errorSoundUrl from '../assets/sounds/error.mp3?url';

export class NotificationController implements ReactiveController {
    host: ReactiveControllerHost & HTMLElement;

    // ─── 依赖注入（由 Root 组件设置） ─────────────────────
    sessionController?: SessionController;
    messageController?: MessageController;
    toastController?: ToastController;
    windowStateController?: WindowStateController;
    settingsController?: SettingsController;
    persistence?: PersistenceLayer;

    // ─── 状态 ─────────────────────────────────────────────
    private _state: NotificationState = {...DEFAULT_NOTIFICATION_STATE};

    readonly actions: NotificationActions;

    get value(): NotificationContextValue {
        return {state: this._state, actions: this.actions};
    }

    // ─── 私有字段 ─────────────────────────────────────────
    private _busUnsubscribe?: () => void;
    private _sounds = new Map<string, HTMLAudioElement>();
    /** 通知动画自动清除定时器 */
    private _animationTimer?: ReturnType<typeof setTimeout>;
    /** 通知节流：防止快速连续通知导致 UI 卡顿 */
    private _lastNotifyTime = 0;
    private static readonly NOTIFY_THROTTLE_MS = 300;

    constructor(host: ReactiveControllerHost & HTMLElement) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            markAsRead: () => this._markAsRead(),
            clearAll: () => this._clearAll(),
        };
    }

    // ─── Lifecycle ─────────────────────────────────────────

    hostConnected(): void {
        this._preloadSounds();
        this._subscribeToMessages();
    }

    hostDisconnected(): void {
        this._busUnsubscribe?.();
        this._sounds.clear();
        this._clearAnimation();
    }

    // ─── 音频管理 ─────────────────────────────────────────

    /**
     * 预加载提示音
     *
     * 关键音效（message）立即加载；非关键音效延迟加载以优化首屏性能。
     * 加载失败时降级处理：不影响 Toast 和动画功能。
     *
     * 注意：音效文件路径在构建时应确保存在，运行时加载失败会降级处理。
     */
    private _preloadSounds(): void {
        // 直接使用 Vite 解析好的资源 URL，无需运行时拼接
        const soundUrls: Record<string, string> = {
            message: messageSoundUrl,
        };

        for (const [type, url] of Object.entries(soundUrls)) {
            this._loadSound(type, url);
        }

        // 延迟加载非关键音效
        const deferredSounds: Record<string, string> = {
            complete: completeSoundUrl,
            error: errorSoundUrl,
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                for (const [type, url] of Object.entries(deferredSounds)) {
                    this._loadSound(type, url);
                }
            });
        } else {
            setTimeout(() => {
                for (const [type, url] of Object.entries(deferredSounds)) {
                    this._loadSound(type, url);
                }
            }, 500);
        }
    }

    private _loadSound(type: string, url: string): void {
        const audio = new Audio();
        audio.preload = 'auto';

        audio.addEventListener('canplaythrough', () => {
            this._sounds.set(type, audio);
        }, {once: true});

        audio.addEventListener('error', () => {
            // 音效文件可能不存在或加载失败，降级处理：不播放该音效
            console.warn(`[NotificationController] 音频加载失败（文件可能不存在）: ${url}`);
            this._sounds.delete(type);
        }, {once: true});

        audio.src = url;
    }

    private _playSound(type: string): void {
        const settings = this.settingsController?.value.state.notifications;
        if (!settings?.soundEnabled) return;

        const sound = this._sounds.get(type);
        if (!sound) return;

        sound.currentTime = 0;
        sound.volume = 1.0;
        sound.play().catch((error) => {
            // 浏览器自动播放策略限制（需用户首次交互后才启用）
            if (error.name === 'NotAllowedError') {
                console.warn('[NotificationController] 音频播放被浏览器阻止，需要用户交互');
            } else {
                console.warn('[NotificationController] 播放失败:', error);
            }
        });
    }

    // ─── 消息订阅 ─────────────────────────────────────────

    /**
     * 订阅 UIUpdateBus 的新消息事件
     *
     * 使用按 entity 过滤的订阅模式（参考 rtc-input-area 用法）。
     * 仅监听 content 字段的 created 事件（消息内容首次写入时触发）。
     */
    private _subscribeToMessages(): void {
        const bus = getUIUpdateBus();
        this._busUnsubscribe = bus.subscribe('message', (event: UIUpdateEvent) => {
            if (event.action === 'created' && event.field === 'content') {
                void this._handleNewMessage(event);
            }
        });
    }

    private async _handleNewMessage(event: UIUpdateEvent): Promise<void> {
        // 节流：防止快速连续通知
        const now = Date.now();
        if (now - this._lastNotifyTime < NotificationController.NOTIFY_THROTTLE_MS) {
            return;
        }

        try {
            // 查询消息所属 session
            const message = this.persistence
                ? await this.persistence.getMessage(event.entityId)
                : undefined;
            const sessionId = message?.session_client_id;
            if (!sessionId) return;

            // 焦点检测
            if (!this._shouldNotify(sessionId)) return;

            this._lastNotifyTime = now;
            this._triggerNotification(event, sessionId);
        } catch (error) {
            console.error('[NotificationController] 处理消息失败:', error);
            // 不中断订阅流，继续处理后续消息
        }
    }

    // ─── 焦点检测 ─────────────────────────────────────────

    /**
     * 判断是否应该触发通知
     *
     * 场景：
     * - 用户在 session A 看消息，session B 收到新消息 → 通知
     * - 用户在 session A 看消息，session A 收到新消息 → 不通知
     * - 用户没在看任何 session → 通知所有新消息
     * - 用户禁用通知 → 所有消息都不通知
     */
    private _shouldNotify(messageSessionId: string): boolean {
        const currentSessionId = this.sessionController?.value.state.currentSessionId;

        // 当前正在查看的 session 收到消息 → 不通知
        if (currentSessionId && messageSessionId === currentSessionId) {
            return false;
        }

        // 检查通知设置
        const settings = this.settingsController?.value.state.notifications;
        if (!settings?.soundEnabled && !settings?.toastEnabled) {
            return false;
        }

        return true;
    }

    // ─── 触发通知 ─────────────────────────────────────────

    private _triggerNotification(
        event: UIUpdateEvent,
        sessionId: string
    ): void {
        // 播放声音
        this._playSound('message');

        // 更新未读计数
        this._state = {
            unreadCount: this._state.unreadCount + 1,
            lastNotificationAt: Date.now(),
        };
        this.host.requestUpdate();

        // 根据窗口状态决定展示方式
        const windowMode = this.windowStateController?.value.state.mode;

        if (windowMode === 'minimized') {
            this._animateMinimizeIcon();
        } else {
            this._showToast(event, sessionId);
        }
    }

    // ─── Toast 显示 ───────────────────────────────────────

    private _showToast(event: UIUpdateEvent, sessionId: string): void {
        const settings = this.settingsController?.value.state.notifications;
        if (!settings?.toastEnabled) return;

        // 提取消息内容（CSS 处理截断，无需手动截断）
        const content = String(event.newValue ?? '');

        // 查找 session 标题
        const sessions = this.sessionController?.value.state.sessions ?? [];
        const session = sessions.find(s => s.clientId === sessionId);
        const title = session?.title ?? msg('新消息');

        // 使用 ToastController 显示通知，附带跳转动作
        this.toastController?.actions.show(
            `${title}: ${content}`,
            'info',
            {
                label: msg('查看'),
                onClick: () => this._navigateToSession(sessionId),
            }
        );
    }

    // ─── 导航跳转 ─────────────────────────────────────────

    /**
     * 跳转到目标 session 并清除通知状态
     *
     * 流程：切换 session → 标记已读 → 派发 rtc-notification-click 事件
     */
    private _navigateToSession(sessionId: string): void {
        this.sessionController?.actions.switchSession(sessionId);
        this.actions.markAsRead();

        this.host.dispatchEvent(
            new CustomEvent('rtc-notification-click', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    // ─── 最小化图标动画 ───────────────────────────────────

    /**
     * 触发最小化图标脉冲动画
     *
     * 通过 host 元素设置 data-notification 属性，
     * CSS 通过 `:host([data-notification])` 选择器触发动画。
     * 动画会一直持续，直到用户展开窗口或点击 bubble。
     */
    private _animateMinimizeIcon(): void {
        this.host.setAttribute('data-notification', 'active');
        // 不再设置超时，动画持续直到用户展开窗口
    }

    private _clearAnimation(): void {
        if (this._animationTimer) {
            clearTimeout(this._animationTimer);
            this._animationTimer = undefined;
        }
        this.host.removeAttribute('data-notification');
    }

    // ─── Actions 实现 ─────────────────────────────────────

    private _markAsRead(): void {
        this._state = {...this._state, unreadCount: 0};
        this._clearAnimation();
        this.host.requestUpdate();
    }

    private _clearAll(): void {
        this._state = {...DEFAULT_NOTIFICATION_STATE};
        this._clearAnimation();
        this.host.requestUpdate();
    }
}
