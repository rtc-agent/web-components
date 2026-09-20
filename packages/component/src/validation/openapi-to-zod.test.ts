import { describe, it, expect } from 'vitest';
import { openApiToZod } from './openapi-to-zod.js';
import type { ParameterDef } from '../types/skill.js';

describe('openApiToZod', () => {
    // ── String type ──

    describe('string type', () => {
        it('should convert basic string parameter', () => {
            const params: ParameterDef[] = [
                { name: 'name', schema: { type: 'string' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ name: 'hello' })).toEqual({ name: 'hello' });
        });

        it('should enforce minLength constraint', () => {
            const params: ParameterDef[] = [
                { name: 'code', schema: { type: 'string', minLength: 3 }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ code: 'ab' })).toThrow();
            expect(schema.parse({ code: 'abc' })).toEqual({ code: 'abc' });
        });

        it('should enforce maxLength constraint', () => {
            const params: ParameterDef[] = [
                { name: 'code', schema: { type: 'string', maxLength: 5 }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ code: 'toolong' })).toThrow();
            expect(schema.parse({ code: 'ok' })).toEqual({ code: 'ok' });
        });

        it('should enforce pattern constraint', () => {
            const params: ParameterDef[] = [
                { name: 'email', schema: { type: 'string', pattern: '^.+@.+$' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ email: 'invalid' })).toThrow();
            expect(schema.parse({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
        });

        it('should handle enum constraint', () => {
            const params: ParameterDef[] = [
                { name: 'level', schema: { type: 'string', enum: ['low', 'high'] }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ level: 'low' })).toEqual({ level: 'low' });
            expect(() => schema.parse({ level: 'medium' })).toThrow();
        });
    });

    // ── Number type ──

    describe('number type', () => {
        it('should convert basic number parameter', () => {
            const params: ParameterDef[] = [
                { name: 'score', schema: { type: 'number' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ score: 3.14 })).toEqual({ score: 3.14 });
        });

        it('should enforce minimum constraint', () => {
            const params: ParameterDef[] = [
                { name: 'age', schema: { type: 'number', minimum: 0 }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ age: -1 })).toThrow();
            expect(schema.parse({ age: 0 })).toEqual({ age: 0 });
        });

        it('should enforce maximum constraint', () => {
            const params: ParameterDef[] = [
                { name: 'percent', schema: { type: 'number', maximum: 100 }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ percent: 101 })).toThrow();
            expect(schema.parse({ percent: 100 })).toEqual({ percent: 100 });
        });

        it('should reject string input for number', () => {
            const params: ParameterDef[] = [
                { name: 'val', schema: { type: 'number' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ val: 'not-a-number' })).toThrow();
        });
    });

    // ── Integer type ──

    describe('integer type', () => {
        it('should accept integer values', () => {
            const params: ParameterDef[] = [
                { name: 'count', schema: { type: 'integer' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ count: 42 })).toEqual({ count: 42 });
        });

        it('should reject floating point values', () => {
            const params: ParameterDef[] = [
                { name: 'count', schema: { type: 'integer' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ count: 3.14 })).toThrow();
        });

        it('should enforce minimum/maximum constraints', () => {
            const params: ParameterDef[] = [
                { name: 'id', schema: { type: 'integer', minimum: 1, maximum: 999 }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ id: 0 })).toThrow();
            expect(() => schema.parse({ id: 1000 })).toThrow();
            expect(schema.parse({ id: 1 })).toEqual({ id: 1 });
        });
    });

    // ── Boolean type ──

    describe('boolean type', () => {
        it('should accept true/false', () => {
            const params: ParameterDef[] = [
                { name: 'flag', schema: { type: 'boolean' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ flag: true })).toEqual({ flag: true });
            expect(schema.parse({ flag: false })).toEqual({ flag: false });
        });

        it('should reject non-boolean values', () => {
            const params: ParameterDef[] = [
                { name: 'flag', schema: { type: 'boolean' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ flag: 'true' })).toThrow();
        });
    });

    // ── Array type ──

    describe('array type', () => {
        it('should convert array with typed items', () => {
            const params: ParameterDef[] = [
                {
                    name: 'tags',
                    schema: { type: 'array', items: { type: 'string' } },
                    required: true,
                },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] });
        });

        it('should enforce minItems', () => {
            const params: ParameterDef[] = [
                {
                    name: 'items',
                    schema: { type: 'array', items: { type: 'number' }, minItems: 2 },
                    required: true,
                },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ items: [1] })).toThrow();
            expect(schema.parse({ items: [1, 2] })).toEqual({ items: [1, 2] });
        });

        it('should enforce maxItems', () => {
            const params: ParameterDef[] = [
                {
                    name: 'items',
                    schema: { type: 'array', items: { type: 'number' }, maxItems: 3 },
                    required: true,
                },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ items: [1, 2, 3, 4] })).toThrow();
            expect(schema.parse({ items: [1, 2, 3] })).toEqual({ items: [1, 2, 3] });
        });

        it('should handle array without items definition', () => {
            const params: ParameterDef[] = [
                { name: 'data', schema: { type: 'array' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ data: [1, 'a', null] })).toEqual({ data: [1, 'a', null] });
        });
    });

    // ── Object type ──

    describe('object type', () => {
        it('should convert object with properties', () => {
            const params: ParameterDef[] = [
                {
                    name: 'address',
                    schema: {
                        type: 'object',
                        properties: {
                            street: { type: 'string' },
                            zip: { type: 'string' },
                        },
                    },
                    required: true,
                },
            ];
            const schema = openApiToZod(params);
            const result = schema.parse({ address: { street: 'Main St', zip: '100000' } });
            expect(result).toEqual({ address: { street: 'Main St', zip: '100000' } });
        });

        it('should enforce required fields within object', () => {
            const params: ParameterDef[] = [
                {
                    name: 'user',
                    schema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', required: true },
                            age: { type: 'integer' },
                        },
                    },
                    required: true,
                },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({ user: { age: 25 } })).toThrow();
            expect(schema.parse({ user: { name: 'Alice' } })).toEqual({ user: { name: 'Alice' } });
        });

        it('should handle object without properties', () => {
            const params: ParameterDef[] = [
                { name: 'meta', schema: { type: 'object' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ meta: { anything: 'goes' } })).toEqual({ meta: { anything: 'goes' } });
        });
    });

    // ── Optional vs required parameters ──

    describe('parameter optionality', () => {
        it('should reject missing required parameter', () => {
            const params: ParameterDef[] = [
                { name: 'name', schema: { type: 'string' }, required: true },
            ];
            const schema = openApiToZod(params);
            expect(() => schema.parse({})).toThrow();
        });

        it('should allow missing optional parameter', () => {
            const params: ParameterDef[] = [
                { name: 'name', schema: { type: 'string' }, required: false },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({})).toEqual({});
        });

        it('should default to optional when required is not set', () => {
            const params: ParameterDef[] = [
                { name: 'name', schema: { type: 'string' } },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({})).toEqual({});
        });
    });

    // ── Description propagation ──

    describe('description', () => {
        it('should use parameter-level description', () => {
            const params: ParameterDef[] = [
                { name: 'q', schema: { type: 'string' }, required: true, description: 'Search query' },
            ];
            const schema = openApiToZod(params);
            // Description is applied to the inner field, not the outer z.object()
            const shape = (schema as any)._def.shape();
            expect(shape.q._def.description).toBe('Search query');
        });

        it('should prefer parameter description over schema description', () => {
            const params: ParameterDef[] = [
                {
                    name: 'q',
                    schema: { type: 'string', description: 'Schema desc' },
                    required: true,
                    description: 'Param desc',
                },
            ];
            const schema = openApiToZod(params);
            const shape = (schema as any)._def.shape();
            expect(shape.q._def.description).toBe('Param desc');
        });

        it('should fall back to schema description', () => {
            const params: ParameterDef[] = [
                {
                    name: 'q',
                    schema: { type: 'string', description: 'Schema desc' },
                    required: true,
                },
            ];
            const schema = openApiToZod(params);
            const shape = (schema as any)._def.shape();
            expect(shape.q._def.description).toBe('Schema desc');
        });
    });

    // ── Unknown type ──

    describe('unknown type', () => {
        it('should accept any value for unknown type', () => {
            const params: ParameterDef[] = [
                { name: 'data', schema: {}, required: true },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ data: 42 })).toEqual({ data: 42 });
            expect(schema.parse({ data: 'str' })).toEqual({ data: 'str' });
            expect(schema.parse({ data: null })).toEqual({ data: null });
        });
    });

    // ── Multiple parameters ──

    describe('multiple parameters', () => {
        it('should handle multiple parameters in one schema', () => {
            const params: ParameterDef[] = [
                { name: 'id', schema: { type: 'integer', minimum: 1 }, required: true },
                { name: 'name', schema: { type: 'string', minLength: 1 }, required: true },
                { name: 'active', schema: { type: 'boolean' }, required: false },
            ];
            const schema = openApiToZod(params);
            const result = schema.parse({ id: 1, name: 'test', active: true });
            expect(result).toEqual({ id: 1, name: 'test', active: true });
        });

        it('should parse with only required params when others are optional', () => {
            const params: ParameterDef[] = [
                { name: 'id', schema: { type: 'integer' }, required: true },
                { name: 'note', schema: { type: 'string' }, required: false },
            ];
            const schema = openApiToZod(params);
            expect(schema.parse({ id: 5 })).toEqual({ id: 5 });
        });
    });

    // ── Nested structures ──

    describe('nested structures', () => {
        it('should handle array of objects', () => {
            const params: ParameterDef[] = [
                {
                    name: 'users',
                    schema: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', required: true },
                            },
                        },
                    },
                    required: true,
                },
            ];
            const schema = openApiToZod(params);
            const result = schema.parse({
                users: [{ name: 'Alice' }, { name: 'Bob' }],
            });
            expect(result).toEqual({
                users: [{ name: 'Alice' }, { name: 'Bob' }],
            });
        });
    });
});
