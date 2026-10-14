/**
 * 通用工具类型
 * 用于从嵌套类型中提取元素类型
 *
 * 注意：基础工具类型（Unpacked, Nullable, DeepPartial, DeepReadonly）
 * 已从 @rtc-agent/protocol 包统一导入。此文件保留原有导出以确保向后兼容。
 */

// Re-export utility types from protocol package
export type { Unpacked, Nullable, DeepPartial, DeepReadonly } from '@rtc-agent/protocol';
