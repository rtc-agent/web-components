import {createContext} from '@lit/context';
import type {ModeConfig, ModeState, ModeActions} from '../types/index.js';

/**
 * Mode Context — current AI working mode and switching actions.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-input-area>, <rtc-mode-panel>
 */
export interface ModeContextValue {
    state: ModeState;
    actions: ModeActions;
}

export const ModeContext = createContext<ModeContextValue>(
    Symbol('mode-context')
);

/** Static config for all 5 modes — used by <rtc-mode-panel> for rendering. */
export const MODE_CONFIGS: ModeConfig[] = [
    {
        mode: 'manual',
        label: '手动',
        icon: 'hand',
        description: 'Claude 会在每次编辑前征求你的同意',
    },
    {
        mode: 'edit',
        label: '编辑',
        icon: 'code',
        description: 'Claude 会自动编辑你选中的文本或整个文件',
    },
    // {
    //     mode: 'plan',
    //     label: 'Plan',
    //     icon: 'tasklist',
    //     description:
    //         'Claude will first explore the code and present a plan before making edits',
    // },
    // {
    //     mode: 'auto',
    //     label: 'Auto',
    //     icon: 'zap',
    //     description:
    //         'Claude will automatically execute operations that pass safety checks, and pause for risky operations',
    // },
    {
        mode: 'bypass',
        label: '绕过权限',
        icon: 'gear',
        description:
            'Claude 不会在执行潜在危险命令前征求同意',
    },
];

export const DEFAULT_MODE_STATE: ModeState = {
    currentMode: 'edit',
};
