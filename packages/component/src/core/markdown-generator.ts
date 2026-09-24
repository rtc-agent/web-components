/**
 * Markdown Generator
 *
 * 从 FunctionDef 生成 markdown 文档
 * 使用 OpenAPI Schema 格式描述参数和返回值
 */

import type { FunctionDef, FunctionGroupDef, RegistryConfig, OpenAPISchema, ParameterDef } from '../types/skill.js';
import { zodToParams } from '../validation/zod-to-openapi.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('MarkdownGenerator');

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

  // 生成示例值
  const exampleStr = schema.example !== undefined ? `\`${JSON.stringify(schema.example)}\`` : '';

  // 基础类型
  if (schema.type && schema.type !== 'object' && schema.type !== 'array') {
    const typeStr = schemaToTypeString(schema);
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} | ${exampleStr} |`);
    return rows;
  }

  // 数组类型
  if (schema.type === 'array' && schema.items) {
    const typeStr = `${schemaToTypeString(schema.items)}[]`;
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} | ${exampleStr} |`);

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
    rows.push(`| ${indent}${displayName} | object | ${reqStr} | ${desc} | ${exampleStr} |`);

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
  rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} | ${exampleStr} |`);
  return rows;
}

/**
 * 生成单个 Function 的 markdown 文档
 *
 * 文件头添加生成标识注释，标识该文件由系统自动生成
 */
export function generateFunctionMd(funcDef: FunctionDef, groupName?: string): string {
  // 生成标识注释（用于识别自动生成的文件）
  let md = `<!-- AUTO-GENERAGED by rtc-agent FunctionRegistry. Do not edit manually. -->\n\n`;
  md += `# ${funcDef.name}\n\n`;
  md += `${funcDef.description}\n\n`;

  // 获取参数定义：优先使用 zodSchema 转换，否则使用 parameters
  let parameters: ParameterDef[] | undefined = funcDef.parameters;
  if (funcDef.zodSchema && !parameters) {
    try {
      parameters = zodToParams(funcDef.zodSchema);
    } catch (err) {
      log.warn(`Failed to convert zodSchema to parameters for ${funcDef.name}:`, err);
    }
  }

  // Parameters (使用 OpenAPI Schema 格式)
  if (parameters && parameters.length > 0) {
    md += `## Parameters\n\n`;
    md += `| Name | Type | Required | Description | Example |\n`;
    md += `|------|------|----------|-------------|---------|\n`;

    for (const param of parameters) {
      const rows = schemaToTableRows(
        param.schema,
        param.name,
        param.required || false,
        (param.description || param.schema.description)?.replaceAll('\n', '<br/>'),
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
    if (parameters) {
      const params = parameters
        .filter(p => p.required)
        .map(p => `  ${p.name}: ${getExampleValue(p.schema)}`)
        .join(',\n');
      md += params + '\n';
    }
    md += `});\n`;
  } else {
    // call 示例
    md += `const result = await rtcAgent.call('${funcDef.name}', {\n`;
    if (parameters) {
      const params = parameters
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

  // 优先使用显式指定的 example
  if (schema.example !== undefined) {
    return JSON.stringify(schema.example);
  }

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
      // 如果有最小值，使用最小值
      if (schema.minimum !== undefined) return String(schema.minimum);
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
          md += `| ${funcName} | ${func.description.replaceAll('\n', '<br/>')} |\n`;
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
      md += `| ${func.name} | ${func.description.replaceAll('\n', '<br/>')} |\n`;
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
 * 生成 AGENT.md
 *
 * Agent Prompt 定义 Agent 的身份、工作流和能力。
 * 前端生成此内容，Server 端有默认降级实现。
 */
export function generateAgentMd(
  config: RegistryConfig,
  functions: FunctionDef[],
  groups: FunctionGroupDef[],
  scenarioCount: number
): string {
  const sections = [
    generateAgentHeader(config),
    generateAgentPersona(config),
    generateAgentEnvironment(),
    generateAgentTools(),
    generateAgentFunctions(functions, groups),
    generateAgentScenarios(scenarioCount),
    generateAgentHowToCall(),
    generateAgentFooter(),
  ];

  return sections.filter(Boolean).join('\n');
}

/**
 * Agent 标题和描述
 */
function generateAgentHeader(config: RegistryConfig): string {
  return `# ${config.name}\n\n${config.description}\n\n`;
}

/**
 * Agent Persona（可选）
 */
function generateAgentPersona(config: RegistryConfig): string {
  if (!config.persona) return '';
  return `## Persona\n\n${config.persona}\n\n`;
}

/**
 * 运行环境上下文
 */
function generateAgentEnvironment(): string {
  return `## Environment

**Execution Context**: Browser-based sandbox environment

**Data Storage**:
- All data is stored in IndexedDB (virtual file system)
- Data stays local on the user's device
- No data is uploaded to remote servers

**Global Objects**:
- \`rtcAgent\`: Pre-injected API object providing access to all registered functions
- \`console.log()\`: Output is captured and returned to you

**File System**:
- \`/functions/\`: Auto-generated function documentation
- \`/scenarios/\`: Business scenario documentation
- \`/scripts/\`: Saved executable JavaScript

`;
}

/**
 * 可用工具列表
 */
function generateAgentTools(): string {
  return `## Available Tools

- **ls**: List directory contents
- **read**: Read file contents
- **write**: Write or create files
- **edit**: Make precise edits to existing files using string replacement
- **find**: Find files by name or pattern
- **grep**: Search file contents
- **script**: Execute JavaScript code (for calling business functions)
- **todoWrite**: Track task progress
- **askUser**: Request user input when needed

`;
}

/**
 * 可用函数列表（按分组组织）
 */
function generateAgentFunctions(functions: FunctionDef[], groups: FunctionGroupDef[]): string {
  // Return empty if no functions at all
  if (functions.length === 0) return '';

  let md = '## Available Functions\n\n';

  // 按分组列出
  for (const group of groups) {
    const groupFunctions = functions.filter(f => f.name.startsWith(group.name + '.'));
    if (groupFunctions.length === 0) continue;

    md += `### ${group.name} - ${group.description}\n\n`;
    for (const func of groupFunctions) {
      const funcName = func.name.split('.')[1];
      md += `- **${funcName}**: ${func.description}\n`;
    }
    md += '\n';
  }

  // 未分组的函数
  const ungroupedFunctions = functions.filter(f => !f.name.includes('.'));
  if (ungroupedFunctions.length > 0) {
    md += `### General Functions\n\n`;
    for (const func of ungroupedFunctions) {
      md += `- **${func.name}**: ${func.description}\n`;
    }
    md += '\n';
  }

  md += `See \`/functions/INDEX.md\` for detailed documentation.\n\n`;
  return md;
}

/**
 * 业务场景（可选）
 */
function generateAgentScenarios(scenarioCount: number): string {
  if (scenarioCount === 0) return '';
  return `## Business Scenarios

There are ${scenarioCount} business scenarios available.

See \`/scenarios/INDEX.md\` for the full list.

`;
}

/**
 * 函数调用说明
 */
function generateAgentHowToCall(): string {
  return `## How to Call Functions

Use the \`script\` tool with \`action: "eval"\` to execute JavaScript code.

### Parameter Passing

**Always pass parameters as an object** with named properties matching the function's parameter names:

\`\`\`javascript
// ✅ Correct - parameters as object
rtcAgent.task.delete({ id: "561a70a1-21b4-4708-b6ff-d8512e1ae1cd" })
rtcAgent.task.create({ title: "Buy groceries", priority: "high" })

// ❌ Wrong - positional arguments
rtcAgent.task.delete("561a70a1-21b4-4708-b6ff-d8512e1ae1cd")
\`\`\`

### Syntax

Use \`rtcAgent.groupName.funcName(params)\` and \`console.log()\` to output results:

\`\`\`javascript
// Create a task
const task = await rtcAgent.task.create({ title: "Buy groceries", priority: "high" })
console.log("Task created:", task)

// List tasks
const tasks = await rtcAgent.task.list()
console.log("Tasks:", tasks)
\`\`\`

**Important**: Use \`console.log()\` to output results. The output will be captured and returned to you.

`;
}

/**
 * 页脚标识
 */
function generateAgentFooter(): string {
  return `---\n*Auto-generated. Do not edit manually.*\n`;
}
