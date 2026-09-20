/**
 * VirtualFS initialization logic
 *
 * Provides AGENT.md template and initialization function.
 */

import { virtualFS } from './virtual-fs.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('VirtualFS');

/**
 * AGENT.md template configuration.
 */
export interface AgentMdConfig {
  /** Application name */
  name?: string;
  /** Application description */
  description?: string;
  /** AI persona */
  persona?: string;
}

/**
 * Generate AGENT.md content from configuration.
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
 * Initialize the virtual file system.
 *
 * Creates the base AGENT.md file if it does not already exist.
 *
 * @param config AGENT.md configuration
 */
export async function initializeVirtualFS(config: AgentMdConfig = {}): Promise<void> {
  try {
    // Check whether AGENT.md already exists
    const exists = await virtualFS.exists('/AGENT.md');
    if (!exists) {
      // Create the base AGENT.md
      const agentContent = generateAgentMd(config);
      await virtualFS.write('/AGENT.md', agentContent, 'overwrite');
      log.info('Initialized: AGENT.md created');
    }
  } catch (err) {
    log.error('Failed to initialize:', err);
    throw err;
  }
}
