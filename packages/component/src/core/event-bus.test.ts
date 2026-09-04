import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, eventBus } from './event-bus.js';

describe('EventBus', () => {
    let bus: EventBus<Record<string, unknown>>;

    beforeEach(() => {
        bus = new EventBus<Record<string, unknown>>();
    });

    it('should call handler when event is emitted', () => {
        const handler = vi.fn();
        bus.on('test', handler);
        bus.emit('test', { value: 42 });
        expect(handler).toHaveBeenCalledWith({ value: 42 });
    });

    it('should support multiple handlers for the same event', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        bus.on('test', handler1);
        bus.on('test', handler2);
        bus.emit('test', 'data');
        expect(handler1).toHaveBeenCalledWith('data');
        expect(handler2).toHaveBeenCalledWith('data');
    });

    it('should not call handler after off()', () => {
        const handler = vi.fn();
        bus.on('test', handler);
        bus.off('test', handler);
        bus.emit('test', 'data');
        expect(handler).not.toHaveBeenCalled();
    });

    it('should only call once() handler once', () => {
        const handler = vi.fn();
        bus.once('test', handler);
        bus.emit('test', 'first');
        bus.emit('test', 'second');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('first');
    });

    it('should return unsubscribe function from on()', () => {
        const handler = vi.fn();
        const unsub = bus.on('test', handler);
        bus.emit('test', 'first');
        unsub();
        bus.emit('test', 'second');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle emit with no handlers gracefully', () => {
        expect(() => bus.emit('nonexistent', 'data')).not.toThrow();
    });

    it('should not fail when handler is removed during emit', () => {
        const handler1 = vi.fn(() => {
            bus.off('test', handler2);
        });
        const handler2 = vi.fn();
        bus.on('test', handler1);
        bus.on('test', handler2);
        // Should not throw even though handler2 is removed during iteration
        expect(() => bus.emit('test', 'data')).not.toThrow();
        // Both handlers should have been called (snapshot before iteration)
        expect(handler1).toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
    });
});

describe('eventBus (global instance)', () => {
    it('should be an instance of EventBus', () => {
        expect(eventBus).toBeInstanceOf(EventBus);
    });
});
