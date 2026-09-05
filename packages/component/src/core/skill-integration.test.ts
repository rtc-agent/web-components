import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FunctionRegistry } from './function-registry.js';
import { eventBus, createEventBus } from './event-bus.js';
import { parseFrontmatter } from './scenario-loader.js';
import type { FunctionDef } from '../types/skill.js';
import type {
  FunctionStartEvent,
  FunctionSuccessEvent,
  FunctionErrorEvent,
} from './event-bus.js';

// Mock @rtc-agent/persistence - factory is hoisted, so no outer-scope references allowed.
vi.mock('@rtc-agent/persistence', () => ({
  virtualFS: {
    write: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(''),
    queryByType: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

import { virtualFS } from '@rtc-agent/persistence';
const mockVirtualFS = vi.mocked(virtualFS);

describe('Skill System Integration', () => {
  let registry: FunctionRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus.clearAll();
    registry = new FunctionRegistry({
      name: 'TestApp',
      description: 'Test Application',
    });
  });

  afterEach(() => {
    eventBus.clearAll();
  });

  describe('1. Function registration -> FS docs -> execution -> logging', () => {
    it('should generate virtualFS docs on register, then execute handler', async () => {
      const handler = vi.fn().mockResolvedValue('done');
      const funcDef: FunctionDef = {
        name: 'user.register',
        description: 'Register a user',
        handler,
      };

      registry.register(funcDef);

      // Wait for fire-and-forget doc generation
      await vi.waitFor(() => {
        expect(mockVirtualFS.write).toHaveBeenCalled();
      });

      // Verify FS docs were generated
      const writeCalls = mockVirtualFS.write.mock.calls;
      const paths = writeCalls.map((c: unknown[]) => c[0] as string);
      expect(paths).toContain('/functions/user/register.md');
      expect(paths).toContain('/functions/INDEX.md');
      // AGENT.md is written after queryByType (also async); wait for it too.
      await vi.waitFor(() => {
        const ps = mockVirtualFS.write.mock.calls.map((c: unknown[]) => c[0] as string);
        expect(ps).toContain('/AGENT.md');
      });

      // Execute
      const result = await registry.execute('user.register', { email: 'a@b.com' });

      expect(handler).toHaveBeenCalledWith(
        { email: 'a@b.com' },
        expect.any(Function),
      );
      expect(result).toBe('done');
    });
  });

  describe('2. Scenario loading -> reading -> FS persistence', () => {
    it('should parse frontmatter and write scenario to virtualFS', async () => {
      const content = `---
title: "Order Checkout"
tags: ["ecommerce", "checkout"]
description: "A complete checkout flow"
---

# Steps

1. Add to cart
2. Enter payment
`;

      // Parse
      const parsed = parseFrontmatter(content);
      expect(parsed.title).toBe('Order Checkout');
      expect(parsed.tags).toEqual(['ecommerce', 'checkout']);
      expect(parsed.description).toBe('A complete checkout flow');
      expect(parsed.body).toContain('# Steps');

      // Write scenario via registry
      await registry.writeScenario({
        title: parsed.title!,
        description: parsed.description,
        tags: parsed.tags,
        content: parsed.body,
      });

      // Verify FS has the scenario file
      const writeCalls = mockVirtualFS.write.mock.calls;
      const paths = writeCalls.map((c: unknown[]) => c[0] as string);
      expect(paths).toContain('/scenarios/order-checkout.md');
      expect(paths).toContain('/scenarios/INDEX.md');

      // Verify content was written (including frontmatter regeneration)
      const scenarioWrite = writeCalls.find(
        (c: unknown[]) => c[0] === '/scenarios/order-checkout.md',
      );
      expect(scenarioWrite).toBeDefined();
      expect(scenarioWrite![1]).toContain('Order Checkout');
      expect(scenarioWrite![1]).toContain('ecommerce');
    });

    it('should slugify CJK titles', async () => {
      await registry.writeScenario({
        title: '用户注册流程',
        content: 'content here',
      });

      const writeCalls = mockVirtualFS.write.mock.calls;
      const paths = writeCalls.map((c: unknown[]) => c[0] as string);
      // CJK characters are preserved in the slug
      expect(paths.some((p: string) => p.startsWith('/scenarios/用户注册流程'))).toBe(true);
    });
  });

  // m7: Sections 3 (Visual hooks triggers) and 4 (SafeLevel=confirm flow) removed.
  // safeLevel has been removed from the codebase - confirmation is now handled
  // by mode switching UI (rtc-input-area->mode-btn) and rtc-tool-confirm.ts.

  // Script engine (scenario 5) skipped: src/core/script-engine.ts does not exist
  // in the current codebase.

  describe('5. EventBus event flow', () => {
    it('should emit function:start then function:success on success', async () => {
      const startHandler = vi.fn();
      const successHandler = vi.fn();
      eventBus.on('function:start', startHandler);
      eventBus.on('function:success', successHandler);

      registry.register({
        name: 'happy.path',
        description: 'Works',
        handler: () => 42,
      });

      const result = await registry.execute('happy.path', {});

      expect(result).toBe(42);
      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);

      const startEvent = startHandler.mock.calls[0][0] as FunctionStartEvent;
      expect(startEvent.path).toBe('happy.path');
      expect(startEvent.params).toEqual({});

      const successEvent = successHandler.mock.calls[0][0] as FunctionSuccessEvent;
      expect(successEvent.path).toBe('happy.path');
      expect(successEvent.result).toBe(42);
    });

    it('should emit function:start then function:error on failure', async () => {
      const startHandler = vi.fn();
      const errorHandler = vi.fn();
      eventBus.on('function:start', startHandler);
      eventBus.on('function:error', errorHandler);

      registry.register({
        name: 'sad.path',
        description: 'Fails',
        handler: () => {
          throw new Error('fail');
        },
      });

      await expect(registry.execute('sad.path', {})).rejects.toThrow('fail');

      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);

      const errorEvent = errorHandler.mock.calls[0][0] as FunctionErrorEvent;
      expect(errorEvent.path).toBe('sad.path');
      expect(errorEvent.error.message).toBe('fail');
    });

    it('should emit function:progress events when handler reports progress', async () => {
      const progressHandler = vi.fn();
      eventBus.on('function:progress', progressHandler);

      registry.register({
        name: 'progress.func',
        description: 'Reports progress',
        handler: async (_params, onProgress) => {
          if (onProgress) {
            await onProgress(0.5);
            await onProgress(1);
          }
          return 'done';
        },
      });

      await registry.execute('progress.func', {});

      expect(progressHandler).toHaveBeenCalledTimes(2);
      expect(progressHandler.mock.calls[0][0]).toMatchObject({
        path: 'progress.func',
        progress: 0.5,
      });
      expect(progressHandler.mock.calls[1][0]).toMatchObject({
        path: 'progress.func',
        progress: 1,
      });
    });

    it('standalone EventBus supports full pub/sub lifecycle', () => {
      const bus = createEventBus<{ 'my:event': { value: number } }>();
      const handler = vi.fn();
      const unsub = bus.on('my:event', handler);

      bus.emit('my:event', { value: 1 });
      expect(handler).toHaveBeenCalledWith({ value: 1 });

      unsub();
      bus.emit('my:event', { value: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
