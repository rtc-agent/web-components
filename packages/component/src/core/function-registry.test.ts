import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FunctionRegistry, FunctionGroup } from './function-registry.js';
import { CancelledError } from '../types/skill.js';
import type { FunctionDef, RegistryConfig } from '../types/skill.js';

// Mock virtualFS
vi.mock('@rtc-agent/persistence', () => ({
    virtualFS: {
        write: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(''),
        queryByType: vi.fn().mockResolvedValue([]),
        mkdir: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('FunctionRegistry', () => {
    let registry: FunctionRegistry;
    let config: RegistryConfig;

    beforeEach(() => {
        vi.clearAllMocks();
        config = {
            name: 'TestApp',
            description: 'Test Application',
        };
        registry = new FunctionRegistry(config);
    });

    describe('register()', () => {
        it('should register a function and make it resolvable', () => {
            const funcDef: FunctionDef = {
                name: 'test',
                description: 'A test function',
                handler: () => 'result',
            };
            const result = registry.register(funcDef);
            expect(result.name).toBe('test');
            expect(registry.resolve('test')).toBe(funcDef);
        });

        it('should list registered functions', () => {
            registry.register({ name: 'func1', description: 'First', handler: () => {} });
            registry.register({ name: 'func2', description: 'Second', handler: () => {} });
            const list = registry.listFunctions();
            expect(list).toHaveLength(2);
            expect(list.map(f => f.name)).toContain('func1');
            expect(list.map(f => f.name)).toContain('func2');
        });
    });

    describe('createGroup()', () => {
        it('should create a function group', () => {
            const group = registry.createGroup({ name: 'user', description: 'User operations' });
            expect(group).toBeInstanceOf(FunctionGroup);
            expect(registry.listGroups()).toHaveLength(1);
        });

        it('should throw if group already exists', () => {
            registry.createGroup({ name: 'user', description: 'User operations' });
            expect(() => registry.createGroup({ name: 'user', description: 'Duplicate' }))
                .toThrow('FunctionGroup already exists: user');
        });
    });

    describe('FunctionGroup.register()', () => {
        it('should register with full name (group.name)', () => {
            const group = registry.createGroup({ name: 'user', description: 'User ops' });
            const funcDef = group.register({ name: 'create', description: 'Create user', handler: () => {} });
            expect(funcDef.name).toBe('user.create');
            expect(registry.resolve('user.create')).toBe(funcDef);
        });

        it('should list functions within group', () => {
            const group = registry.createGroup({ name: 'user', description: 'User ops' });
            group.register({ name: 'create', description: 'Create', handler: () => {} });
            group.register({ name: 'delete', description: 'Delete', handler: () => {} });
            const funcs = group.listFunctions();
            expect(funcs).toHaveLength(2);
        });
    });

    describe('execute()', () => {
        it('should execute a function handler', async () => {
            const handler = vi.fn().mockResolvedValue('success');
            registry.register({
                name: 'test',
                description: 'Test',
                handler,
            });
            const result = await registry.execute('test', { param1: 'value1' });
            expect(handler).toHaveBeenCalledWith({ param1: 'value1' }, expect.any(Function));
            expect(result).toBe('success');
        });

        it('should throw if function not found', async () => {
            await expect(registry.execute('nonexistent', {}))
                .rejects.toThrow('Function not found: nonexistent');
        });

        it('should call onStart hook before handler', async () => {
            const callOrder: string[] = [];
            registry.register({
                name: 'test',
                description: 'Test',
                hooks: {
                    onStart: () => { callOrder.push('onStart'); },
                },
                handler: () => { callOrder.push('handler'); },
            });
            await registry.execute('test', {});
            expect(callOrder).toEqual(['onStart', 'handler']);
        });

        it('should not call onError if onStart throws CancelledError', async () => {
            const onError = vi.fn();
            registry.register({
                name: 'test',
                description: 'Test',
                hooks: {
                    onStart: () => { throw new CancelledError(); },
                    onError,
                },
                handler: () => {},
            });
            await expect(registry.execute('test', {})).rejects.toThrow(CancelledError);
            expect(onError).not.toHaveBeenCalled();
        });
    });

    describe('unregister()', () => {
        it('should remove function from registry', async () => {
            registry.register({ name: 'test', description: 'Test', handler: () => {} });
            expect(registry.resolve('test')).toBeDefined();
            await registry.unregister('test');
            expect(registry.resolve('test')).toBeUndefined();
        });

        it('should do nothing if function does not exist', async () => {
            await expect(registry.unregister('nonexistent')).resolves.toBeUndefined();
        });
    });

    describe('createProxy()', () => {
        it('should allow access to registered methods', () => {
            const proxy = registry.createProxy();
            expect(typeof proxy.register).toBe('function');
            expect(typeof proxy.execute).toBe('function');
            expect(typeof proxy.listFunctions).toBe('function');
        });

        it('should allow access to groups by name', () => {
            registry.createGroup({ name: 'user', description: 'User ops' });
            const proxy = registry.createProxy();
            expect((proxy as any).user).toBeInstanceOf(FunctionGroup);
        });

        it('should not expose private properties', () => {
            const proxy = registry.createProxy();
            expect((proxy as any).functions).toBeUndefined();
            expect((proxy as any).groups).toBeUndefined();
        });
    });
});
