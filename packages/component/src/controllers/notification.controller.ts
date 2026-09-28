/**
 * Notification Controller
 *
 * Lightweight notification system: listens for new message events via UIUpdateBus,
 * triggers sound alerts, toast notifications, and minimized icon animations
 * based on focus detection logic.
 *
 * Architecture:
 * - Subscribes to UIUpdateBus 'message' events (filtered by entity)
 * - Queries the message's session via PersistenceLayer
 * - Focus detection: no notification for the current session; notify for other sessions
 * - Notification display: normal mode → Toast, minimized mode → icon animation
 *
 * Corresponds to: `NotificationContext` (defined in `contexts/notification.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: Components that need to be aware of unread notifications
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
import { createLogger } from '@rtc-agent/client';
import { extractTextContent } from '../utils/format.js';
import type {ContentData} from '../types/index.js';

const log = createLogger('NotificationController');

// Sound resource URLs: Vite's `?url` suffix resolves to a correct accessible URL
// in both dev and build (dev: dev server path; build: hashed path under dist),
// loading correctly regardless of whether the component is deployed at root,
// a subpath, or a CDN. Compared to the old `new URL('./', import.meta.url).pathname`
// approach: (1) no 404 from host mismatch; (2) sound files don't need to be in the same directory as scripts.
import messageSoundUrl from '../assets/sounds/message.mp3?url';
import completeSoundUrl from '../assets/sounds/complete.mp3?url';
import errorSoundUrl from '../assets/sounds/error.mp3?url';

export class NotificationController implements ReactiveController {
    host: ReactiveControllerHost & HTMLElement;

    // ─── Dependency injection (set by Root component) ─────────────────────
    sessionController?: SessionController;
    messageController?: MessageController;
    toastController?: ToastController;
    windowStateController?: WindowStateController;
    settingsController?: SettingsController;
    persistence?: PersistenceLayer;

    // ─── State ──────────────────────────────────────────────
    private _state: NotificationState = {...DEFAULT_NOTIFICATION_STATE};

    readonly actions: NotificationActions;

    get value(): NotificationContextValue {
        return {state: this._state, actions: this.actions};
    }

    // ─── Private fields ────────────────────────────────────────
    private _busUnsubscribe?: () => void;
    private _sounds = new Map<string, HTMLAudioElement>();
    /** Timer for deferred sound loading (non-critical sounds, cleaned up on unmount) */
    private _deferredSoundTimer?: ReturnType<typeof setTimeout>;
    /** Handle returned by requestIdleCallback, used in hostDisconnected to cancel untriggered idle callbacks. */
    private _idleCallbackId?: number;
    /** Notification throttle: prevent UI jank from rapid successive notifications */
    private _lastNotifyTime = 0;
    private static readonly NOTIFY_THROTTLE_MS = 300;
    /** Fallback delay (ms) when `requestIdleCallback` is available but hasn't fired yet. */
    private static readonly IDLE_FALLBACK_DELAY_MS = 2000;
    /** Delay (ms) for deferred sound loading when `requestIdleCallback` is not available. */
    private static readonly DEFERRED_SOUND_DELAY_MS = 500;
    /** AbortController for async operations, aborted on hostDisconnected to prevent stale operations */
    private _abortController = new AbortController();

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
        if (this._deferredSoundTimer) {
            clearTimeout(this._deferredSoundTimer);
            this._deferredSoundTimer = undefined;
        }
        // Cancel any pending idle callback to prevent loading sounds after disconnect.
        if (this._idleCallbackId !== undefined) {
            cancelIdleCallback(this._idleCallbackId);
            this._idleCallbackId = undefined;
        }
        // Abort any pending async operations to prevent stale operations after disconnect
        this._abortController.abort();
        this._abortController = new AbortController();
        this.host.removeAttribute('data-notification');
    }

    // ─── Audio management ──────────────────────────────────

    /**
     * Preload notification sounds
     *
     * Critical sounds (message) load immediately; non-critical sounds load deferred
     * to optimize first-paint performance. Load failures degrade gracefully:
     * Toast and animation features are unaffected.
     *
     * Note: sound file paths should be verified at build time; runtime load failures degrade gracefully.
     */
    private _preloadSounds(): void {
        // Clear previously loaded sounds to avoid duplicates on reconnect cycles.
        this._sounds.clear();
        // Use Vite-resolved asset URLs directly; no runtime path construction needed
        const soundUrls: Record<string, string> = {
            message: messageSoundUrl,
        };

        for (const [type, url] of Object.entries(soundUrls)) {
            this._loadSound(type, url);
        }

        // Deferred loading of non-critical sounds
        const deferredSounds: Record<string, string> = {
            complete: completeSoundUrl,
            error: errorSoundUrl,
        };

        /** Load deferred sounds and clear any pending fallback timer. */
        const loadDeferred = () => {
            // Clear fallback timer if it hasn't fired yet (prevents duplicate loading
            // when requestIdleCallback fires before the setTimeout fallback).
            if (this._deferredSoundTimer !== undefined) {
                clearTimeout(this._deferredSoundTimer);
                this._deferredSoundTimer = undefined;
            }
            // Clear idle callback reference — it has now fired.
            this._idleCallbackId = undefined;
            for (const [type, url] of Object.entries(deferredSounds)) {
                this._loadSound(type, url);
            }
        };

        // Cancel any previously pending idle callback (handles reconnect cycles
        // where hostConnected fires multiple times without a disconnect in between).
        if (this._idleCallbackId !== undefined) {
            cancelIdleCallback(this._idleCallbackId);
            this._idleCallbackId = undefined;
        }

        if ('requestIdleCallback' in window) {
            this._idleCallbackId = requestIdleCallback(loadDeferred);
            // Fallback: if idle callback doesn't fire within IDLE_FALLBACK_DELAY_MS, load manually.
            this._deferredSoundTimer = setTimeout(() => {
                if (this._idleCallbackId !== undefined) {
                    cancelIdleCallback(this._idleCallbackId);
                    this._idleCallbackId = undefined;
                }
                loadDeferred();
            }, NotificationController.IDLE_FALLBACK_DELAY_MS);
        } else {
            this._deferredSoundTimer = setTimeout(loadDeferred, NotificationController.DEFERRED_SOUND_DELAY_MS);
        }
    }

    private _loadSound(type: string, url: string): void {
        const audio = new Audio();
        audio.preload = 'auto';

        // Guard: only register the sound if the controller is still connected.
        // Without this, hostDisconnected → _sounds.clear() can be followed by
        // a late canplaythrough event that re-populates the map with a stale
        // reference that will never be cleaned up.
        audio.addEventListener('canplaythrough', () => {
            if (this.host.isConnected) {
                this._sounds.set(type, audio);
            }
        }, {once: true});

        audio.addEventListener('error', () => {
            // Sound file may not exist or failed to load; degrade gracefully: don't play this sound
            log.warn(`Audio load failed (file may not exist): ${url}`);
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
            // Browser autoplay policy restriction (requires user interaction first)
            if (error.name === 'NotAllowedError') {
                log.warn('Audio playback blocked by browser; user interaction required');
            } else {
                log.warn('Playback failed:', error);
            }
        });
    }

    // ─── Message subscription ──────────────────────────────────

    /**
     * Subscribe to new message events from UIUpdateBus
     *
     * Uses entity-filtered subscription pattern (see rtc-input-area usage).
     * Only listens for 'created' events on the content field (triggered on first message write).
     */
    private _subscribeToMessages(): void {
        // Guard against re-entrant calls: unsubscribe previous listener before
        // creating a new one. Without this, disconnect → reconnect cycles leak
        // the old bus subscription (the unsubscribe reference is overwritten).
        this._busUnsubscribe?.();
        const bus = getUIUpdateBus();
        this._busUnsubscribe = bus.subscribe('message', (event: UIUpdateEvent) => {
            if (event.action === 'created' && event.field === 'content') {
                void this._handleNewMessage(event);
            }
        });
    }

    private async _handleNewMessage(event: UIUpdateEvent): Promise<void> {
        // Throttle: prevent rapid successive notifications
        const now = Date.now();
        if (now - this._lastNotifyTime < NotificationController.NOTIFY_THROTTLE_MS) {
            return;
        }

        try {
            // Capture abort signal before async operation to detect disconnection
            const abortSignal = this._abortController.signal;

            // Query the session the message belongs to
            const message = this.persistence
                ? await this.persistence.getMessage(event.entityId)
                : undefined;

            // Check if aborted during await (e.g., host disconnected)
            if (abortSignal.aborted) {
                return;
            }

            const sessionId = message?.session_client_id;
            if (!sessionId) return;

            // Focus detection
            if (!this._shouldNotify(sessionId)) return;

            this._lastNotifyTime = now;
            this._triggerNotification(event, sessionId);
        } catch (error) {
            // Ignore AbortError from disconnection
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }
            log.error('Failed to handle message:', error);
            // Do not interrupt the subscription stream; continue processing subsequent messages
        }
    }

    // ─── Focus detection ─────────────────────────────────────

    /**
     * Determine whether a notification should be triggered
     *
     * Scenarios:
     * - User is viewing session A, session B receives a new message → notify
     * - User is viewing session A, session A receives a new message → do not notify
     * - User is not viewing any session → notify for all new messages
     * - User has disabled notifications → no notifications for any messages
     */
    private _shouldNotify(messageSessionId: string): boolean {
        const currentSessionId = this.sessionController?.value.state.currentSessionId;

        // Message received for the session currently being viewed → do not notify
        if (currentSessionId && messageSessionId === currentSessionId) {
            return false;
        }

        // Check notification settings
        const settings = this.settingsController?.value.state.notifications;
        if (!settings?.soundEnabled && !settings?.toastEnabled) {
            return false;
        }

        return true;
    }

    // ─── Trigger notification ──────────────────────────────────

    private _triggerNotification(
        event: UIUpdateEvent,
        sessionId: string
    ): void {
        // Play sound
        this._playSound('message');

        // Update unread count
        this._state = {
            unreadCount: this._state.unreadCount + 1,
            lastNotificationAt: Date.now(),
        };
        this.host.requestUpdate();

        // Determine display method based on window state
        const windowMode = this.windowStateController?.value.state.mode;

        if (windowMode === 'minimized') {
            this._animateMinimizeIcon();
        } else {
            this._showToast(event, sessionId);
        }
    }

    // ─── Toast display ───────────────────────────────────────

    private _showToast(event: UIUpdateEvent, sessionId: string): void {
        const settings = this.settingsController?.value.state.notifications;
        if (!settings?.toastEnabled) return;

        // Extract readable text from ContentData object (instead of direct String() conversion)
        const contentData = event.newValue as ContentData | undefined;
        const content = extractTextContent(contentData);

        // Look up session title
        const sessions = this.sessionController?.value.state.sessions ?? [];
        const session = sessions.find(s => s.clientId === sessionId);
        const title = session?.title ?? msg('新消息');

        // Use ToastController to show notification with a navigate action
        this.toastController?.actions.show(
            `${title}: ${content}`,
            'info',
            {
                label: msg('查看'),
                onClick: () => this._navigateToSession(sessionId),
            }
        );
    }

    // ─── Navigation ────────────────────────────────────────────

    /**
     * Navigate to the target session and clear notification state
     *
     * Flow: switch session → mark as read → dispatch rtc-notification-click event
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

    // ─── Minimized icon animation ──────────────────────────────

    /**
     * Trigger minimized icon pulse animation
     *
     * Sets the data-notification attribute on the host element;
     * CSS triggers animation via the `:host([data-notification])` selector.
     * Animation persists until the user expands the window or clicks the bubble.
     */
    private _animateMinimizeIcon(): void {
        this.host.setAttribute('data-notification', 'active');
        // No timeout set; animation persists until user expands the window
    }

    private _clearAnimation(): void {
        this.host.removeAttribute('data-notification');
    }

    // ─── Actions implementation ────────────────────────────────

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
