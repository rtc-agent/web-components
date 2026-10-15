import { createContext } from '@lit/context';
import { msg } from '@lit/localize';
import type { ModeActions, ModeConfig, ModeState } from '../types/index.js';

/**
 * Mode Context — current AI working mode and switching actions.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-input-area>, <rtc-mode-panel>
 *
 * @example
 * ```ts
 * // Consuming in a LitElement component:
 * import { consume } from '@lit/context';
 * import { ModeContext, type ModeContextValue } from './contexts/mode.js';
 *
 * class MyComponent extends LitElement {
 *   @consume({ context: ModeContext })
 *   private _modeContext!: ModeContextValue;
 *
 *   render() {
 *     const { state, actions } = this._modeContext;
 *     return html`
 *       <div>Current mode: ${state.currentMode}</div>
 *       <select @change=${(e) => actions.setMode(e.target.value)}>
 *         <option value="manual">Manual</option>
 *         <option value="edit">Edit</option>
 *       </select>
 *     `;
 *   }
 * }
 * ```
 */
export interface ModeContextValue {
  state: ModeState;
  actions: ModeActions;
}

export const ModeContext = createContext<ModeContextValue>(
  Symbol('mode-context'),
);

/** Static config for all 5 modes — used by <rtc-mode-panel> for rendering. */
export const MODE_CONFIGS: ModeConfig[] = [
  {
    mode: 'manual',
    label: msg('手动'),
    icon: 'hand',
    description: msg('Claude 会在每次编辑前征求你的同意'),
  },
  {
    mode: 'edit',
    label: msg('编辑'),
    icon: 'code',
    description: msg('Claude 会自动编辑你选中的文本或整个文件'),
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
    label: msg('绕过权限'),
    icon: 'gear',
    description: msg('Claude 不会在执行潜在危险命令前征求同意'),
  },
];

export const DEFAULT_MODE_STATE: ModeState = {
  currentMode: 'edit',
};
