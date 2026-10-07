/**
 * 通用工具类型
 * 用于从嵌套类型中提取元素类型
 */

/** 从数组类型中提取元素类型，非数组则返回原类型 */
export type Unpacked<T> = T extends (infer U)[] ? U : T;
