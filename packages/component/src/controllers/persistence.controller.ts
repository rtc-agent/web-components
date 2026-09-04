/**
 * Persistence Controller
 *
 * Manages the PersistenceLayer lifecycle: creates it lazily, connects when
 * auth succeeds, disconnects on logout or host teardown.
 *
 * The PersistenceLayer wraps RTCAgentClient (WebSocket) + IndexedDB, providing
 * offline-capable data persistence and real-time sync.
 *
 * Corresponds to: no context (infrastructure concern, not UI state).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: other controllers (via `persistence.layer`)
 */
import type {ReactiveController} from 'lit';
import {
    createPersistenceLayer,
    type PersistenceLayer,
} from '@rtc-agent/persistence';
import type {AuthController} from './auth.controller.js';
import {AUTH_CONFIG, STORAGE_KEYS} from '../config/auth.js';

/**
 * Load or create the persistent device ID.
 *
 * Stored in localStorage under `rtc_device_id`. Created once on first use,
 * reused across sessions so the backend can identify the same device.
 */
function getOrCreateDeviceId(): string {
    let id = localStorage.getItem(STORAGE_KEYS.deviceId);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEYS.deviceId, id);
    }
    return id;
}

export class PersistenceController implements ReactiveController {
    private _layer?: PersistenceLayer;
    private _auth: AuthController;

    constructor(host: {addController(c: ReactiveController): void}, auth: AuthController) {
        this._auth = auth;
        host.addController(this);
    }

    /** The PersistenceLayer instance. Only available after connect(). */
    get layer(): PersistenceLayer | undefined {
        return this._layer;
    }

    /** Whether the persistence layer is connected. */
    get isConnected(): boolean {
        return this._layer !== undefined;
    }

    hostConnected() {
        // No-op: connection is driven by auth state, not host lifecycle.
    }

    hostDisconnected() {
        this.disconnect();
    }

    /**
     * Create the PersistenceLayer and connect.
     *
     * Call this after auth succeeds (tokens are set in AuthController).
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    async connect(): Promise<void> {
        if (this._layer) return;

        const deviceId = getOrCreateDeviceId();
        const userId = this._auth.state.userId;
        console.log('[PersistenceController] connect() → wsEndpoint:', AUTH_CONFIG.wsEndpoint, 'deviceId:', deviceId, 'userId:', userId);

        this._layer = createPersistenceLayer({
            databaseName: userId ? `rtc-agent-${userId}` : undefined,
            client: {
                endpoint: AUTH_CONFIG.wsEndpoint,
                getToken: () => {
                    const token = this._auth.getAccessToken();
                    console.log('[PersistenceController] getToken →', token ? `${token.slice(0, 20)}...` : 'UNDEFINED');
                    if (!token) throw new Error('No access token available');
                    return token;
                },
                onTokenExpired: () => this._auth.handleTokenExpired(),
                deviceId,
                userId,
            },
        });

        await this._layer.connect();
    }

    /**
     * Disconnect and tear down the PersistenceLayer.
     *
     * Call this on logout or when auth is lost.
     */
    async disconnect(): Promise<void> {
        if (this._layer) {
            // 先重置 offset
            await this._layer.getOffsetManager().reset();
            // 关闭 WS + DB
            await this._layer.close();
            this._layer = undefined;
        }
    }
}
