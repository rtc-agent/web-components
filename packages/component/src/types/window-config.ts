/**
 * Window Configuration Types
 *
 * 用于 <rtc-agent> 组件的窗口配置 API。
 * 控制窗口的默认状态、尺寸、位置、交互限制等。
 */

/**
 * Bubble 位置配置
 *
 * 使用数学笛卡尔坐标系：
 * - 原点在宿主应用的某个角（由 corner 决定）
 * - x 轴：右正左负
 * - y 轴：上正下负（数学坐标系，非屏幕坐标系）
 *
 * 象限分布：
 * - top-left: 第四象限 (x>0, y<0)
 * - top-right: 第三象限 (x<0, y<0)
 * - bottom-left: 第一象限 (x>0, y>0)
 * - bottom-right: 第二象限 (x<0, y>0)
 */
export type BubbleCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface BubblePosition {
    /** 坐标系原点在宿主应用的哪个角 */
    corner: BubbleCorner;
    /** 相对于原点的偏移（数学笛卡尔坐标） */
    offset: { x: number; y: number };
}

/**
 * 窗口配置
 *
 * 通过 <rtc-agent>.windowConfig 属性设置。
 */
export interface WindowConfig {
    // ── 默认状态 ──────────────────────────────────────

    /** 默认窗口模式 */
    defaultMode?: 'normal' | 'maximized' | 'minimized';

    /** 初始位置（仅 normal 模式生效） */
    initialPosition?: { x: number; y: number };

    /** 初始尺寸（仅 normal 模式生效） */
    initialSize?: { width: number; height: number };

    // ── 尺寸限制 ──────────────────────────────────────

    /** 最小宽度 */
    minWidth?: number;

    /** 最小高度 */
    minHeight?: number;

    /** 最大宽度（默认视口宽度） */
    maxWidth?: number;

    /** 最大高度（默认视口高度） */
    maxHeight?: number;

    // ── 交互控制 ──────────────────────────────────────

    /** 是否允许拖拽（默认 true） */
    draggable?: boolean;

    /** 是否允许调整大小（默认 true） */
    resizable?: boolean;

    // ── 按钮控制 ──────────────────────────────────────

    /** 是否显示最小化按钮（默认 true） */
    showMinimize?: boolean;

    /** 是否显示最大化按钮（默认 true） */
    showMaximize?: boolean;

    /** 是否显示关闭按钮（默认 false，关闭=最小化） */
    showClose?: boolean;

    // ── 嵌入模式 ──────────────────────────────────────

    /**
     * 嵌入模式（禁用所有窗口交互）
     *
     * 等同于：
     * - draggable: false
     * - resizable: false
     * - showMinimize: false
     * - showMaximize: false
     * - showClose: false
     * - defaultMode: 'maximized'
     */
    embedded?: boolean;

    // ── Bubble 位置 ──────────────────────────────────────

    /**
     * 最小化 bubble 的位置配置
     *
     * 使用数学笛卡尔坐标系，原点在宿主应用的某个角。
     * 默认值：{ corner: 'bottom-right', offset: { x: -20, y: 20 } }
     */
    bubblePosition?: BubblePosition;
}

/**
 * 解析后的窗口配置（所有字段都有默认值）
 */
export interface ResolvedWindowConfig {
    defaultMode: 'normal' | 'maximized' | 'minimized';
    initialPosition: { x: number; y: number };
    initialSize: { width: number; height: number };
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
    draggable: boolean;
    resizable: boolean;
    showMinimize: boolean;
    showMaximize: boolean;
    showClose: boolean;
    embedded: boolean;
    bubblePosition: BubblePosition;
}

/**
 * 默认窗口配置
 */
export const DEFAULT_WINDOW_CONFIG: ResolvedWindowConfig = {
    defaultMode: 'normal',
    initialPosition: { x: -1, y: -1 },  // -1 表示使用默认计算逻辑（右下角）
    initialSize: { width: 420, height: 640 },
    minWidth: 350,
    minHeight: 520,
    maxWidth: Infinity,
    maxHeight: Infinity,
    draggable: true,
    resizable: true,
    showMinimize: true,
    showMaximize: true,
    showClose: false,
    embedded: false,
    bubblePosition: { corner: 'bottom-right', offset: { x: -20, y: 20 } },  // 右下角向内偏移 20px
};

/**
 * 解析窗口配置（合并默认值）
 *
 * embedded: true 会覆盖交互相关配置
 */
export function resolveWindowConfig(config?: WindowConfig): ResolvedWindowConfig {
    if (!config) return { ...DEFAULT_WINDOW_CONFIG };

    // embedded 模式：禁用所有交互
    if (config.embedded) {
        return {
            ...DEFAULT_WINDOW_CONFIG,
            ...config,
            draggable: false,
            resizable: false,
            showMinimize: false,
            showMaximize: false,
            showClose: false,
            defaultMode: config.defaultMode ?? 'maximized',
            bubblePosition: config.bubblePosition ?? DEFAULT_WINDOW_CONFIG.bubblePosition,
        };
    }

    return {
        ...DEFAULT_WINDOW_CONFIG,
        ...config,
        initialPosition: config.initialPosition ?? DEFAULT_WINDOW_CONFIG.initialPosition,
        initialSize: config.initialSize ?? DEFAULT_WINDOW_CONFIG.initialSize,
        bubblePosition: config.bubblePosition ?? DEFAULT_WINDOW_CONFIG.bubblePosition,
    };
}
