/**
 * VirtualFS 初始化逻辑
 *
 * 提供 AGENT.md 模板和初始化函数
 */

import { virtualFS } from './virtual-fs.js';

/**
 * AGENT.md 模板配置
 */
export interface AgentMdConfig {
  /** 应用名称 */
  name?: string;
  /** 应用描述 */
  description?: string;
  /** AI 人设 */
  persona?: string;
}

/**
 * 生成 AGENT.md 内容
 */
export function generateAgentMd(config: AgentMdConfig = {}): string {
  const { name = 'RTC Agent', description = 'Your AI-powered assistant', persona = '' } = config;

  let content = `# ${name}\n\n`;
  content += `${description}\n\n`;

  if (persona) {
    content += `## Persona\n\n${persona}\n\n`;
  }

  content += `## Available Tools

- \`ls\`: List directory contents
- \`read\`: Read file contents
- \`write\`: Write or create files
- \`find\`: Find files by pattern
- \`grep\`: Search file contents

## File System Structure

- \`/functions/\`: Function documentation (auto-generated)
- \`/scenarios/\`: Scenario documentation (business workflows)
- \`/scripts/\`: Saved scripts (executable JavaScript)
- \`/AGENT.md\`: This file (system entry point)

## Getting Started

The AI Agent can discover and use Functions registered by the host application.
Functions are documented in \`/functions/\` directory.

For business workflows, check \`/scenarios/\` directory.

---
*This file is auto-generated. Content will be updated as Functions and Scenarios are registered.*
`;

  return content;
}

/**
 * 初始化虚拟文件系统
 *
 * 创建基础的 AGENT.md 文件（如果不存在）
 *
 * @param config AGENT.md 配置
 */
export async function initializeVirtualFS(config: AgentMdConfig = {}): Promise<void> {
  try {
    // 检查 AGENT.md 是否存在
    const exists = await virtualFS.exists('/AGENT.md');
    if (!exists) {
      // 创建基础 AGENT.md
      const agentContent = generateAgentMd(config);
      await virtualFS.write('/AGENT.md', agentContent, 'overwrite');
      console.log('[VirtualFS] Initialized: AGENT.md created');
    }
  } catch (err) {
    console.error('[VirtualFS] Failed to initialize:', err);
    throw err;
  }
}
