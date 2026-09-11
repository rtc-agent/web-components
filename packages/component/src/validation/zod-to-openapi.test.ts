import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToParams, withMeta } from './zod-to-openapi.js';

describe('zodToParams', () => {
  it('should convert schema with describe and withMeta', () => {
    const schema = z.object({
      id: withMeta(z.number().int().positive('记录 ID 必须是正整数'), { example: 1 })
        .describe('记录 ID（正整数）'),
      level: withMeta(z.enum(['year', 'month', 'day', 'hour']).optional(), { example: 'hour' })
        .describe('查看粒度：year/month/day/hour，可选'),
    });

    const params = zodToParams(schema);
    console.log('Params:', JSON.stringify(params, null, 2));
    
    expect(params).toHaveLength(2);
    expect(params[0].name).toBe('id');
    expect(params[0].required).toBe(true);
    expect(params[0].description).toBe('记录 ID（正整数）');
    expect(params[0].schema.example).toBe(1);
    
    expect(params[1].name).toBe('level');
    expect(params[1].required).toBe(false);
    expect(params[1].description).toBe('查看粒度：year/month/day/hour，可选');
    expect(params[1].schema.example).toBe('hour');
  });
});
