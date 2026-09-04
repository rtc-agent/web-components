/**
 * Markdown Generator
 *
 * 从 FunctionDef 生成 markdown 文档
 * 使用 OpenAPI Schema 格式描述参数和返回值
 */

import type { FunctionDef, FunctionGroupDef, RegistryConfig, OpenAPISchema } from '../types/skill.js';

/**
 * 将 OpenAPI Schema 转换为可读的类型字符串
 *
 * 参考 openapi-markdown 的 dataTypes.js 逻辑
 */
function schemaToTypeString(schema: OpenAPISchema): string {
  if (!schema) return 'unknown';

  // 引用类型
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() || schema.$ref;
    return `[${name}](${schema.$ref})`;
  }

  // 数组类型
  if (schema.type === 'array' && schema.items) {
    const itemType = schemaToTypeString(schema.items);
    return `${itemType}[]`;
  }

  // 对象类型（有 properties）
  if (schema.type === 'object' && schema.properties) {
    const props = Object.entries(schema.properties)
      .map(([key, val]) => `${key}: ${schemaToTypeString(val)}`)
      .join(', ');
    return `{ ${props} }`;
  }

  // 基础类型 + 格式
  if (schema.type) {
    if (schema.format) {
      return `${schema.type} (${schema.format})`;
    }
    return schema.type;
  }

  // 只有格式
  if (schema.format) {
    return schema.format;
  }

  return 'unknown';
}

/**
 * 递归生成 Schema 的详细描述表格行
 *
 * 参考 openapi-markdown 的 pathParameters.js 逻辑
 */
function schemaToTableRows(
  schema: OpenAPISchema,
  name: string,
  required: boolean,
  description?: string,
  depth: number = 0
): string[] {
  const rows: string[] = [];
  const indent = ' '.repeat(depth);
  const displayName = depth > 0 ? `└─ ${name}` : name;

  // 基础类型
  if (schema.type && schema.type !== 'object' && schema.type !== 'array') {
    const typeStr = schemaToTypeString(schema);
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} |`);
    return rows;
  }

  // 数组类型
  if (schema.type === 'array' && schema.items) {
    const typeStr = `${schemaToTypeString(schema.items)}[]`;
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} |`);

    // 如果 items 是对象，展开其属性
    if (schema.items.type === 'object' && schema.items.properties) {
      const requiredFields = (schema.items.required || []) as string[];
      for (const [propName, propSchema] of Object.entries(schema.items.properties)) {
        const propRequired = requiredFields.includes(propName);
        rows.push(...schemaToTableRows(propSchema, propName, propRequired, propSchema.description, depth + 1));
      }
    }
    return rows;
  }

  // 对象类型
  if (schema.type === 'object' && schema.properties) {
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | object | ${reqStr} | ${desc} |`);

    // 展开属性
    const requiredFields = (schema.required || []) as string[];
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propRequired = requiredFields.includes(propName);
      rows.push(...schemaToTableRows(propSchema, propName, propRequired, propSchema.description, depth + 1));
    }
    return rows;
  }

  // 其他情况
  const typeStr = schemaToTypeString(schema);
  const desc = description || schema.description || '';
  const reqStr = required ? 'Yes' : 'No';
  rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} |`);
  return rows;
}

/**
 * 生成单个 Function 的 markdown 文档
 */
export function generateFunctionMd(funcDef: FunctionDef, groupName?: string): string {
  let md = `# ${funcDef.name}\n\n`;
  md += `${funcDef.description}\n\n`;

  // Parameters (使用 OpenAPI Schema 格式)
  if (funcDef.parameters && funcDef.parameters.length > 0) {
    md += `## Parameters\n\n`;
    md += `| Name | Type | Required | Description |\n`;
    md += `|------|------|----------|-------------|\n`;

    for (const param of funcDef.parameters) {
      const rows = schemaToTableRows(
        param.schema,
        param.name,
        param.required || false,
        param.description || param.schema.description
      );
      md += rows.join('\n') + '\n';
    }
    md += '\n';
  }

  // Returns (使用 OpenAPI Schema 格式)
  if (funcDef.returns) {
    md += `## Returns\n\n`;
    const returnType = schemaToTypeString(funcDef.returns.schema);
    md += `**Type:** ${returnType}\n\n`;
    if (funcDef.returns.description || funcDef.returns.schema.description) {
      md += `${funcDef.returns.description || funcDef.returns.schema.description}\n\n`;
    }

    // 如果是对象类型，展开属性
    if (funcDef.returns.schema.type === 'object' && funcDef.returns.schema.properties) {
      md += `| Field | Type | Description |\n`;
      md += `|-------|------|-------------|\n`;
      const requiredFields = (funcDef.returns.schema.required || []) as string[];
      for (const [propName, propSchema] of Object.entries(funcDef.returns.schema.properties)) {
        const propType = schemaToTypeString(propSchema);
        const propDesc = propSchema.description || '';
        const reqMark = requiredFields.includes(propName) ? ' *(required)*' : '';
        md += `| ${propName} | ${propType} | ${propDesc}${reqMark} |\n`;
      }
      md += '\n';
    }
  }

  // Example
  md += `## Example\n\n`;
  md += '```javascript\n';
  if (groupName) {
    // 链式调用示例
    const funcName = funcDef.name.split('.')[1];
    md += `const result = await rtcAgent.${groupName}.${funcName}({\n`;
    if (funcDef.parameters) {
      const params = funcDef.parameters
        .filter(p => p.required)
        .map(p => `  ${p.name}: ${getExampleValue(p.schema)}`)
        .join(',\n');
      md += params + '\n';
    }
    md += `});\n`;
  } else {
    // call 示例
    md += `const result = await rtcAgent.call('${funcDef.name}', {\n`;
    if (funcDef.parameters) {
      const params = funcDef.parameters
        .filter(p => p.required)
        .map(p => `  ${p.name}: ${getExampleValue(p.schema)}`)
        .join(',\n');
      md += params + '\n';
    }
    md += `});\n`;
  }
  md += '```\n';

  return md;
}

/**
 * 根据 OpenAPI Schema 生成示例值
 */
function getExampleValue(schema: OpenAPISchema): string {
  if (!schema) return 'null';

  // 枚举值
  if (schema.enum && schema.enum.length > 0) {
    return JSON.stringify(schema.enum[0]);
  }

  // 默认值
  if (schema.default !== undefined) {
    return JSON.stringify(schema.default);
  }

  // 根据类型生成示例
  switch (schema.type) {
    case 'string':
      if (schema.format === 'date') return '"2024-01-01"';
      if (schema.format === 'date-time') return '"2024-01-01T00:00:00Z"';
      if (schema.format === 'email') return '"user@example.com"';
      if (schema.format === 'uri') return '"https://example.com"';
      if (schema.format === 'uuid') return '"550e8400-e29b-41d4-a716-446655440000"';
      return '"example"';
    case 'number':
    case 'integer':
      return '0';
    case 'boolean':
      return 'true';
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    default:
      return 'null';
  }
}

/**
 * 生成 Functions 索引（按分组组织）
 */
export function generateFunctionsIndex(
  functions: FunctionDef[],
  groups: FunctionGroupDef[]
): string {
  let md = '# Functions Index\n\n';

  // 按分组组织
  if (groups.length > 0) {
    for (const group of groups) {
      const groupFunctions = functions.filter(f => f.name.startsWith(group.name + '.'));

      if (groupFunctions.length > 0) {
        md += `## ${group.name} - ${group.description}\n\n`;
        md += `| Function | Description |\n`;
        md += `|----------|-------------|\n`;

        for (const func of groupFunctions) {
          const funcName = func.name.split('.')[1];
          md += `| ${funcName} | ${func.description} |\n`;
        }
        md += '\n';
      }
    }
  }

  // 未分组的 Functions
  const ungroupedFunctions = functions.filter(f => !f.name.includes('.'));
  if (ungroupedFunctions.length > 0) {
    md += `## General Functions\n\n`;
    md += `| Function | Description |\n`;
    md += `|----------|-------------|\n`;

    for (const func of ungroupedFunctions) {
      md += `| ${func.name} | ${func.description} |\n`;
    }
    md += '\n';
  }

  md += `---\n**总计**: ${functions.length} 个 Functions，${groups.length} 个分组\n`;

  return md;
}

/**
 * 生成 Scenarios 索引
 */
export function generateScenariosIndex(scenarios: Array<{
  path: string;
  metadata: { name?: string; tags?: string[]; description?: string };
}>): string {
  let md = '# Scenarios Index\n\n';
  md += '| Title | Description | File | Tags |\n';
  md += '|-------|-------------|------|------|\n';

  for (const scenario of scenarios) {
    const title = scenario.metadata.name || 'Untitled';
    const description = scenario.metadata.description || '';
    const tags = scenario.metadata.tags?.join(', ') || '';
    const filename = scenario.path.split('/').pop() || '';
    md += `| ${title} | ${description} | ${filename} | ${tags} |\n`;
  }

  md += `\n---\n**总计**: ${scenarios.length} 个 Scenarios\n`;

  return md;
}

/**
 * 生成 AGENT.md（符合设计文档的丰富格式）
 */
export function generateAgentMd(
  config: RegistryConfig,
  functions: FunctionDef[],
  groups: FunctionGroupDef[],
  scenarioCount: number
): string {
  let md = `# ${config.name}\n\n`;
  md += `${config.description}\n\n`;

  if (config.persona) {
    md += `## Persona\n\n${config.persona}\n\n`;
  }

  // Quick Navigation
  md += `## Quick Navigation\n\n`;
  md += `- [Available Functions](#available-functions)\n`;
  md += `- [Business Scenarios](#business-scenarios)\n`;
  md += `- [System Tools](#system-tools)\n\n`;

  // Available Functions (detailed listing)
  md += `## Available Functions\n\n`;

  if (groups.length > 0) {
    for (const group of groups) {
      const groupFunctions = functions.filter(f => f.name.startsWith(group.name + '.'));

      if (groupFunctions.length > 0) {
        md += `### ${group.name} - ${group.description}\n\n`;

        for (const func of groupFunctions) {
          const funcName = func.name.split('.')[1];
          md += `- **${funcName}**: ${func.description}\n`;
        }
        md += '\n';
      }
    }
  }

  // Ungrouped functions
  const ungroupedFunctions = functions.filter(f => !f.name.includes('.'));
  if (ungroupedFunctions.length > 0) {
    md += `### General Functions\n\n`;
    for (const func of ungroupedFunctions) {
      md += `- **${func.name}**: ${func.description}\n`;
    }
    md += '\n';
  }

  md += `See \`/functions/INDEX.md\` for detailed documentation.\n\n`;

  // Business Scenarios
  if (scenarioCount > 0) {
    md += `## Business Scenarios\n\n`;
    md += `There are ${scenarioCount} business scenarios available.\n\n`;
    md += `See \`/scenarios/INDEX.md\` for the full list.\n\n`;
  }

  // System Tools
  md += `## System Tools\n\n`;
  md += `- \`ls\`: List directory contents\n`;
  md += `- \`read\`: Read file contents\n`;
  md += `- \`write\`: Write or create files\n`;
  md += `- \`find\`: Find files by pattern\n`;
  md += `- \`grep\`: Search file contents\n`;
  md += `- \`script\`: Execute JavaScript code (action: "eval") or save/run scripts\n\n`;

  // How to Call Functions
  md += `## How to Call Functions\n\n`;
  md += `**Recommended**: Use the \`script\` tool with \`action: "eval"\` to execute JavaScript code.\n\n`;
  md += `### Parameter Passing\n\n`;
  md += `**Always pass parameters as an object** with named properties matching the function's parameter names:\n\n`;
  md += `\`\`\`javascript\n`;
  md += `// ✅ Correct - parameters as object\n`;
  md += `rtcAgent.task.delete({ id: "561a70a1-21b4-4708-b6ff-d8512e1ae1cd" })\n`;
  md += `rtcAgent.task.create({ title: "Buy groceries", priority: "high" })\n`;
  md += `rtcAgent.task.update({ id: "123", completed: true })\n\n`;
  md += `// ❌ Wrong - positional arguments\n`;
  md += `rtcAgent.task.delete("561a70a1-21b4-4708-b6ff-d8512e1ae1cd")\n`;
  md += `rtcAgent.task.create("Buy groceries", "high")\n`;
  md += `\`\`\`\n\n`;
  md += `Check each function's documentation in \`/functions/\` for the exact parameter names and types.\n\n`;
  md += `### Syntax\n\n`;
  md += `Use \`rtcAgent.groupName.funcName(params)\` and \`console.log()\` to output results:\n\n`;
  md += `\`\`\`javascript\n`;
  md += `// ✅ Create a task\n`;
  md += `const task = await rtcAgent.task.create({ title: "Buy groceries", priority: "high" })\n`;
  md += `console.log("Task created:", task)\n\n`;
  md += `// ✅ Delete a task\n`;
  md += `const result = await rtcAgent.task.delete({ id: "task-id-here" })\n`;
  md += `console.log("Delete result:", result)\n\n`;
  md += `// ✅ List tasks\n`;
  md += `const tasks = await rtcAgent.task.list()\n`;
  md += `console.log("Tasks:", tasks)\n\n`;
  md += `// ✅ Filter and process\n`;
  md += `const tasks = await rtcAgent.task.list()\n`;
  md += `const active = tasks.filter(t => !t.completed)\n`;
  md += `console.log("Active tasks:", active)\n\n`;
  md += `// ❌ Wrong - missing rtcAgent prefix\n`;
  md += `task.create({ title: "Buy groceries" })\n`;
  md += `\`\`\`\n\n`;
  md += `**Important**: Use \`console.log()\` to output results. The output will be captured and returned to you.\n\n`;
  md += `### Script Tool Parameters\n\n`;
  md += `\`\`\`json\n`;
  md += `{\n`;
  md += `  "action": "eval",\n`;
  md += `  "code": "const tasks = await rtcAgent.task.list()\\nconsole.log(tasks)"\n`;
  md += `}\n`;
  md += `\`\`\`\n\n`;
  md += `The \`rtcAgent\` object is available in the script sandbox and provides access to all registered functions.\n\n`;

  // File System Structure
  md += `## File System Structure\n\n`;
  md += `- \`/functions/\`: Function documentation (auto-generated)\n`;
  md += `- \`/scenarios/\`: Scenario documentation (business workflows)\n`;
  md += `- \`/scripts/\`: Saved scripts (executable JavaScript)\n`;
  md += `- \`/AGENT.md\`: This file (system entry point)\n\n`;

  // Usage Suggestions
  md += `## Usage Suggestions\n\n`;
  md += `1. Start by reading this file (\`/AGENT.md\`) to understand the system\n`;
  md += `2. Browse \`/functions/INDEX.md\` to see available functions\n`;
  md += `3. Read specific function docs in \`/functions/{group}/{name}.md\`\n`;

  if (scenarioCount > 0) {
    md += `4. Review business scenarios in \`/scenarios/\` to understand workflows\n`;
  }

  md += `5. Use \`script\` tool with \`action: "eval"\` to call functions (see "How to Call Functions" above)\n\n`;

  md += `---\n*Auto-generated. Do not edit manually.*\n`;

  return md;
}
