/**
 * Debug API type definitions.
 *
 * Defines the shape of `window.rtcAgentDebug` — the comprehensive debug and
 * testing interface exposed for E2E testing and development introspection.
 */
import type {RtcAgent} from './components/rtc-agent/rtc-agent.js';

/**
 * The shape of `window.rtcAgentDebug`.
 *
 * All methods are safe to call at any time; they return sensible defaults
 * when the component is not yet connected or persistence is not ready.
 */
export interface RtcAgentDebugAPI {
    // ── State Query ──

    /**
     * Snapshot of the component's internal state.
     *
     * Returns auth, session, messages, window mode, activity, connection,
     * and other controller states as plain objects.
     */
    getState(): Record<string, unknown>;

    // ── Data Manipulation ──

    /**
     * Clear all persistent data and disconnect live connections.
     *
     * Performs a full teardown in the correct order:
     * 1. Disconnect persistence layer (closes SharedWorker, Centrifuge WS, WorkerBridge)
     * 2. Reset auth state (clears tokens, stops refresh timers)
     * 3. Clear localStorage, sessionStorage, and all IndexedDB databases
     *
     * This ensures no stale async callbacks (e.g., Centrifuge token expiry -> handleTokenExpired
     * -> _logout) can corrupt state after clearing. After calling, the component is in a clean
     * initial state and ready for re-login without requiring a page reload.
     */
    clearData(): Promise<void>;

    /**
     * Seed test data into the component.
     *
     * Supported keys:
     * - `tokens`: { accessToken, refreshToken, userId, expiresIn } — bypass auth
     * - `messages`: not directly supported (messages come from server via persistence)
     * - `files`: Array<{ path: string; content: string }> — write to VirtualFS
     */
    seedData(data: Record<string, unknown>): Promise<void>;

    // ── Auth Bypass ──

    /**
     * Skip the OAuth2 flow and inject tokens directly.
     *
     * This triggers the same code path as a successful OAuth2 callback,
     * including persistence connection and session loading.
     */
    loginAs(userId: string, tokens?: { accessToken?: string; refreshToken?: string }): void;

    /**
     * Log out the current user (clears tokens, disconnects persistence).
     */
    logout(): void;

    // ── Event Simulation ──

    /**
     * Dispatch a custom event on the <rtc-agent> element.
     *
     * The event bubbles and crosses shadow DOM boundaries (composed: true).
     */
    triggerEvent(name: string, detail?: unknown): void;

    // ── VirtualFS ──

    /** List all files in the virtual file system (recursive). */
    listFiles(path?: string): Promise<string[]>;

    /** Read a file from the virtual file system. */
    readFile(path: string): Promise<string>;

    /** Write a file to the virtual file system. */
    writeFile(path: string, content: string): Promise<void>;

    /** Delete a file from the virtual file system. */
    deleteFile(path: string): Promise<void>;

    // ── Logs ──

    /**
     * Recent log entries (ring buffer, newest last).
     *
     * Each entry is formatted as `[ISO-timestamp] [level] message`.
     */
    readonly logs: readonly string[];

    /** Clear the log buffer. */
    clearLogs(): void;

    // ── UI Control ──

    /**
     * Click an element matching the given CSS selector (within the component's shadow DOM).
     *
     * Supports deep selectors using `>>>` syntax for crossing shadow boundaries.
     */
    click(selector: string): Promise<boolean>;

    /** Scroll an element into view within the component. */
    scrollIntoView(selector: string): Promise<boolean>;

    /** Type text into an input element (fires input + change events). */
    typeText(selector: string, text: string): Promise<boolean>;

    // ── Component Reference ──

    /** Direct reference to the <rtc-agent> element (for advanced test scenarios). */
    readonly element: RtcAgent | null;

    /**
     * Wait for the component to be ready (rtc-agent-ready event fired).
     *
     * Returns immediately if already ready.
     */
    waitForReady(timeoutMs?: number): Promise<RtcAgent>;

    /**
     * Wait for persistence to connect.
     *
     * Returns true if connected within timeout, false otherwise.
     */
    waitForConnected(timeoutMs?: number): Promise<boolean>;

    // ── Session Management ──

    /** Create a new session and switch to it. Returns the clientId. */
    createSession(): string | null;

    /** Switch to an existing session by clientId. Returns true if found. */
    switchSession(sessionId: string): boolean;

    /** Delete a session by clientId. */
    deleteSession(sessionId: string): Promise<{ok: boolean; error?: string}>;

    /** Rename a session by clientId. */
    renameSession(sessionId: string, title: string): Promise<{ok: boolean; error?: string}>;

    /** Get all sessions as a list of plain objects. */
    getSessions(): Array<{clientId: string; title: string; status?: string; updatedAt?: number}>;

    /** Get the current session's clientId, or null if none is selected. */
    getCurrentSessionId(): string | null;

    // ── Message Operations ──

    /**
     * Send a text message in the current session.
     *
     * This triggers the same code path as user input submission, including
     * persistence write and server sync. Requires auth and persistence to be ready.
     */
    sendMessage(content: string): Promise<void>;

    /** Get messages in the current session as plain objects. */
    getMessages(): Array<{
        clientId: string;
        role: string;
        content: unknown;
        timestamp: number;
        syncStatus: string;
        streaming: boolean;
    }>;

    /** Add a demo assistant message (for testing message rendering without server). */
    addDemoMessage(content: string, role?: 'user' | 'assistant'): void;

    /** Clear all messages in the current session. */
    clearMessages(): void;

    // ── Tool Call Simulation ──

    /** Get pending tool calls as plain objects. */
    getToolCalls(): Array<{
        id: string;
        toolName: string;
        command?: string;
        description?: string;
        parameters?: Record<string, unknown>;
    }>;

    /** Add a pending tool call (simulates a tool call from the protocol layer). */
    addPendingToolCall(call: {
        id?: string;
        toolName: string;
        command?: string;
        description?: string;
        parameters?: Record<string, unknown>;
    }): void;

    /** Approve a pending tool call by ID. Returns true if found. */
    approveToolCall(callId: string): boolean;

    /** Deny a pending tool call by ID. Returns true if found. */
    denyToolCall(callId: string): boolean;

    /** Approve all pending tool calls for a given tool name. */
    approveAllToolCalls(toolName: string): void;

    // ── Toast / Notification ──

    /** Show a toast notification. */
    showToast(message: string, type?: 'info' | 'success' | 'error'): void;

    /** Get current toast notifications. */
    getToasts(): Array<{id: number; message: string; type: string}>;

    // ── Settings ──

    /** Get current settings state. */
    getSettings(): Record<string, unknown>;

    /**
     * Update a settings section.
     *
     * Supported sections: 'appearance', 'chat', 'files', 'notifications'.
     */
    updateSettings(section: string, patch: Record<string, unknown>): void;

    // ── Activity / Layout ──

    /** Switch the active activity panel (e.g., 'chat', 'files', 'settings'). */
    setActivity(activity: string): void;

    /** Get the current activity state. */
    getActivity(): {active: string; sidebarVisible: boolean};

    // ── Performance Metrics ──

    /**
     * Collect performance metrics for the current page.
     *
     * Includes DOM node count, memory usage (Chrome-only), navigation timing,
     * resource summary, and component state.
     */
    getMetrics(): Record<string, unknown>;

    // ── Network Simulation ──

    /** Simulate offline mode by blocking fetch and WebSocket. */
    simulateOffline(): void;

    /** Restore normal network behavior after simulateOffline(). */
    restoreNetwork(): void;

    /** Whether network simulation is currently active. */
    readonly isOffline: boolean;
}
