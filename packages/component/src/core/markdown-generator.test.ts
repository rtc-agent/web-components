import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateFunctionMd } from './markdown-generator.js';
import { withMeta } from '../validation/zod-to-openapi.js';
import type { FunctionDef } from '../types/skill.js';

describe('generateFunctionMd with zodSchema', () => {
  it('should generate parameters table from zodSchema', () => {
    const liuyaoGetSchema = z.object({
      id: withMeta(z.number().int().positive('记录 ID 必须是正整数'), { example: 1 })
        .describe('记录 ID（正整数）'),
      level: withMeta(z.enum(['year', 'month', 'day', 'hour']).optional(), { example: 'hour' })
        .describe('查看粒度：year/month/day/hour，可选'),
    });

    const funcDef: FunctionDef = {
      name: 'liuyao.get',
      description: '获取六爻记录的详细信息。',
      zodSchema: liuyaoGetSchema,
      handler: async () => ({}),
    };

    const md = generateFunctionMd(funcDef, 'liuyao');
    console.log('Generated Markdown:\n', md);

    expect(md).toContain('## Parameters');
    expect(md).toContain('| id |');
    expect(md).toContain('记录 ID（正整数）');
    expect(md).toContain('| level |');
    expect(md).toContain('查看粒度');
    expect(md).toContain('## Example');
  });
});
