/**
 * Markdown Generator
 *
 * Generates markdown documentation from FunctionDef.
 * Uses OpenAPI Schema format to describe parameters and return values.
 */

import type { FunctionDef, FunctionGroupDef, RegistryConfig, OpenAPISchema, ParameterDef } from '../types/skill.js';
import { zodToParams } from '../validation/zod-to-openapi.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('MarkdownGenerator');

/**
 * Convert OpenAPI Schema to a readable type string
 *
 * References openapi-markdown's dataTypes.js logic
 */
function schemaToTypeString(schema: OpenAPISchema): string {
  if (!schema) return 'unknown';

  // Reference type
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() || schema.$ref;
    return `[${name}](${schema.$ref})`;
  }

  // Array type
  if (schema.type === 'array' && schema.items) {
    const itemType = schemaToTypeString(schema.items);
    return `${itemType}[]`;
  }

  // Object type (with properties)
  if (schema.type === 'object' && schema.properties) {
    const props = Object.entries(schema.properties)
      .map(([key, val]) => `${key}: ${schemaToTypeString(val)}`)
      .join(', ');
    return `{ ${props} }`;
  }

  // Primitive type + format
  if (schema.type) {
    if (schema.format) {
      return `${schema.type} (${schema.format})`;
    }
    return schema.type;
  }

  // Format only
  if (schema.format) {
    return schema.format;
  }

  return 'unknown';
}

/**
 * Recursively generate detailed description table rows for a Schema
 *
 * References openapi-markdown's pathParameters.js logic
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

  // Generate example value
  const exampleStr = schema.example !== undefined ? `\`${JSON.stringify(schema.example)}\`` : '';

  // Primitive type
  if (schema.type && schema.type !== 'object' && schema.type !== 'array') {
    const typeStr = schemaToTypeString(schema);
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} | ${exampleStr} |`);
    return rows;
  }

  // Array type
  if (schema.type === 'array' && schema.items) {
    const typeStr = `${schemaToTypeString(schema.items)}[]`;
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} | ${exampleStr} |`);

    // If items is an object, expand its properties
    if (schema.items.type === 'object' && schema.items.properties) {
      const requiredFields = (schema.items.required || []) as string[];
      for (const [propName, propSchema] of Object.entries(schema.items.properties)) {
        const propRequired = requiredFields.includes(propName);
        rows.push(...schemaToTableRows(propSchema, propName, propRequired, propSchema.description, depth + 1));
      }
    }
    return rows;
  }

  // Object type
  if (schema.type === 'object' && schema.properties) {
    const desc = description || schema.description || '';
    const reqStr = required ? 'Yes' : 'No';
    rows.push(`| ${indent}${displayName} | object | ${reqStr} | ${desc} | ${exampleStr} |`);

    // Expand properties
    const requiredFields = (schema.required || []) as string[];
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propRequired = requiredFields.includes(propName);
      rows.push(...schemaToTableRows(propSchema, propName, propRequired, propSchema.description, depth + 1));
    }
    return rows;
  }

  // Other cases
  const typeStr = schemaToTypeString(schema);
  const desc = description || schema.description || '';
  const reqStr = required ? 'Yes' : 'No';
  rows.push(`| ${indent}${displayName} | ${typeStr} | ${reqStr} | ${desc} | ${exampleStr} |`);
  return rows;
}

/**
 * Generate markdown documentation for a single Function
 *
 * Adds a generation identifier comment at the file header to mark it as auto-generated
 */
export function generateFunctionMd(funcDef: FunctionDef, groupName?: string): string {
  // Generate identifier comment (used to identify auto-generated files)
  let md = `<!-- AUTO-GENERAGED by rtc-agent FunctionRegistry. Do not edit manually. -->\n\n`;
  md += `# ${funcDef.name}\n\n`;
  md += `${funcDef.description}\n\n`;

  // Get parameter definition: prefer zodSchema conversion, otherwise use parameters
  let parameters: ParameterDef[] | undefined = funcDef.parameters;
  if (funcDef.zodSchema && !parameters) {
    try {
      parameters = zodToParams(funcDef.zodSchema);
    } catch (err) {
      log.warn(`Failed to convert zodSchema to parameters for ${funcDef.name}:`, err);
    }
  }

  // Parameters (using OpenAPI Schema format)
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

  // Returns (using OpenAPI Schema format)
  if (funcDef.returns) {
    md += `## Returns\n\n`;
    const returnType = schemaToTypeString(funcDef.returns.schema);
    md += `**Type:** ${returnType}\n\n`;
    if (funcDef.returns.description || funcDef.returns.schema.description) {
      md += `${funcDef.returns.description || funcDef.returns.schema.description}\n\n`;
    }

    // If it's an object type, expand properties
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
  md += `**You must use the \`script\`tool to execute the script below.**\n\n`;
  md += '```javascript\n';
  if (groupName) {
    // Chain call example
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
    // call example
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
 * Generate example value based on OpenAPI Schema
 */
function getExampleValue(schema: OpenAPISchema): string {
  if (!schema) return 'null';

  // Prefer explicitly specified example
  if (schema.example !== undefined) {
    return JSON.stringify(schema.example);
  }

  // Enum value
  if (schema.enum && schema.enum.length > 0) {
    return JSON.stringify(schema.enum[0]);
  }

  // Default value
  if (schema.default !== undefined) {
    return JSON.stringify(schema.default);
  }

  // Generate example based on type
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
      // If minimum is specified, use it
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
 * Generate Functions index (organized by group)
 */
export function generateFunctionsIndex(
  functions: FunctionDef[],
  groups: FunctionGroupDef[]
): string {
  let md = '# Functions Index\n\n';

  // Organize by group
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

  // Ungrouped Functions
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

  md += `---\n**Total**: ${functions.length} Functions, ${groups.length} groups\n`;

  return md;
}

/**
 * Generate Scenarios index
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

  md += `\n---\n**Total**: ${scenarios.length} Scenarios\n`;

  return md;
}

/**
 * Generate AGENT.md
 *
 * Agent Prompt defines the Agent's identity, workflow, and capabilities.
 * The frontend generates this content; the server has a default fallback implementation.
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
 * Agent title and description
 */
function generateAgentHeader(config: RegistryConfig): string {
  return `# ${config.name}\n\n${config.description}\n\n`;
}

/**
 * Agent Persona (optional)
 */
function generateAgentPersona(config: RegistryConfig): string {
  if (!config.persona) return '';
  return `## Persona\n\n${config.persona}\n\n`;
}

/**
 * Runtime environment context
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
 * Available tools list
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
- **webSearch**: Search the web for current information (when configured)
- **webFetch**: Fetch and read web page content (when configured)

`;
}

/**
 * Available functions list (organized by group)
 */
function generateAgentFunctions(functions: FunctionDef[], groups: FunctionGroupDef[]): string {
  // Return empty if no functions at all
  if (functions.length === 0) return '';

  let md = '## Available Functions\n\n';

  // List by group
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
  return md;
}

/**
 * Business scenarios (optional)
 */
function generateAgentScenarios(scenarioCount: number): string {
  if (scenarioCount === 0) return '';
  return `## Business Scenarios

There are ${scenarioCount} business scenarios available.

See \`/scenarios/INDEX.md\` for the full list.

`;
}

/**
 * Function call instructions
 */
function generateAgentHowToCall(): string {
  return `## How to Call Functions

You are extremely cautious. You always read the \`/Function/INDEX.md\` document first and write the \`script\` based on it.

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
 * Footer identifier
 */
function generateAgentFooter(): string {
  return `---\n*Auto-generated. Do not edit manually.*\n`;
}
