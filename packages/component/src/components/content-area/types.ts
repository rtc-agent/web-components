/**
 * Content Area Types
 *
 * 集中定义 content-area 模块内部共享的类型，
 * 避免在组件文件里散落重复的类型声明，
 * 同时为后续复用与单元测试提供清晰的模块边界。
 *
 * @module content-area/types
 */

import type {Message} from '../../types/index.js';
import type {ToolCallPair} from './rtc-toolcall-card.js';

/**
 * 渲染项类型（经过 `_buildRenderItems` 处理后的消息表示）
 *
 * 虚拟滚动器将数据源映射为该联合类型的数组，
 * 每个变体通过 `type` 判别，渲染阶段据此分派到对应的消息组件。
 *
 * @remarks
 * - `user`      → 渲染为用户消息气泡（`rtc-user-message`）
 * - `assistant` → 渲染为 AI 回复（`rtc-message`）
 * - `toolcall`  → 渲染为工具调用卡片（`rtc-toolcall-card`），`pair` 包含输入/输出
 * - `error`     → 渲染为错误提示（`rtc-error-message`）
 */
export type RenderItem =
  | {type: 'user'; key: string; message: Message}
  | {type: 'assistant'; key: string; message: Message}
  | {type: 'toolcall'; key: string; pair: ToolCallPair}
  | {type: 'error'; key: string; message: Message};
