/**
 * Content Area Types
 *
 * Centralizes types shared within the content-area module,
 * avoiding scattered duplicate type declarations across component files
 * and providing a clear module boundary for reuse and unit testing.
 *
 * @module content-area/types
 */

import type {Message} from '../../types/index.js';
import type {ToolCallPair} from './rtc-toolcall-card.js';

/**
 * Render item type (message representation after `_buildRenderItems` processing).
 *
 * The virtualizer maps its data source to an array of this discriminated union.
 * Each variant is identified by `type`, and the render phase dispatches
 * to the corresponding message component accordingly.
 *
 * @remarks
 * - `user`      → rendered as a user message bubble (`rtc-user-message`)
 * - `assistant` → rendered as an AI reply (`rtc-message`)
 * - `toolcall`  → rendered as a tool call card (`rtc-toolcall-card`), `pair` contains input/output
 * - `error`     → rendered as an error hint (`rtc-error-message`)
 */
export type RenderItem =
  | {type: 'user'; key: string; message: Message}
  | {type: 'assistant'; key: string; message: Message}
  | {type: 'toolcall'; key: string; pair: ToolCallPair}
  | {type: 'error'; key: string; message: Message};
