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
        label: 'Manual',
        icon: 'hand',
        description: 'Claude will ask for approval before making each edit',
    },
    {
        mode: 'edit',
        label: 'Edit automatically',
        icon: 'code',
        description: 'Claude will edit your selected text or the whole file',
    },
    // {
    //     mode: 'plan',
    //     label: 'Plan',
    //     icon: 'tasklist',
    //     description:
    //         'Claude will explore the code and present a plan before editing',
    // },
    // {
    //     mode: 'auto',
    //     label: 'Auto',
    //     icon: 'zap',
    //     description:
    //         'Claude will approve actions that pass a safety check and pause for anything risky',
    // },
    {
        mode: 'bypass',
        label: 'Bypass permissions',
        icon: 'gear',
        description:
            'Claude will not ask for approval before running potentially dangerous commands',
    },
];

export const DEFAULT_MODE_STATE: ModeState = {
    currentMode: 'edit',
};
