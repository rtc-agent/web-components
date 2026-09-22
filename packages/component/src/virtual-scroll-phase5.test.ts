/**
 * Virtual Scroll Phase 5 Tests
 *
 * Tests for:
 * - Update handling (data model + placeholder invalidation)
 * - Performance characteristics
 * - Edge cases
 * - User experience scenarios
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {MessageVirtualScroll} from '../src/utils/message-virtual-scroll.js';

// Test item type
interface TestMessage {
    id: string;
    content: string;
    timestamp: number;
    streaming?: boolean;
}

// Helper to create test messages
function createMessage(id: string, content: string, streaming = false): TestMessage {
    return {
        id,
        content,
        timestamp: Date.now(),
        streaming,
    };
}

// Helper to create a render function
function createRenderFn() {
    return (item: TestMessage, index: number) => {
        const el = document.createElement('div');
        el.className = 'message';
        el.dataset.messageIndex = String(index);
        el.dataset.itemId = item.id;
        el.dataset.isSkeleton = 'false';
        el.textContent = item.content;
        el.style.height = '100px'; // Fixed height for testing
        return el;
    };
}

// Helper to create update function
function createUpdateFn() {
    return (element: HTMLElement, item: TestMessage, index: number) => {
        element.textContent = item.content;
        element.dataset.messageIndex = String(index);
    };
}

describe('MessageVirtualScroll - Phase 5: Update Handling', () => {
    let scrollContainer: HTMLElement;
    let innerContainer: HTMLElement;
    let virtualScroll: MessageVirtualScroll<TestMessage>;

    beforeEach(() => {
        // Setup DOM
        scrollContainer = document.createElement('div');
        scrollContainer.style.height = '500px';
        scrollContainer.style.overflow = 'auto';

        innerContainer = document.createElement('div');
        scrollContainer.appendChild(innerContainer);

        document.body.appendChild(scrollContainer);
    });

    afterEach(() => {
        virtualScroll?.dispose();
        document.body.removeChild(scrollContainer);
    });

    describe('updateItems with placeholders', () => {
        it('should update data model even when item is a placeholder', () => {
            const messages = [
                createMessage('1', 'Message 1'),
                createMessage('2', 'Message 2'),
                createMessage('3', 'Message 3'),
            ];

            virtualScroll = new MessageVirtualScroll<TestMessage>({
                scrollContainer,
                innerContainer,
                renderItem: createRenderFn(),
                getItemId: (item) => item.id,
                updateItemElement: createUpdateFn(),
                isItemStable: () => true,
            });

            virtualScroll.setItems(messages);

            // Simulate skeletonization of message 2
            const placeholder = document.createElement('div');
            placeholder.className = 'message-skeleton';
            placeholder.dataset.itemId = '2';
            placeholder.dataset.isSkeleton = 'true';
            placeholder.style.height = '100px';

            const originalElement = innerContainer.children[1] as HTMLElement;
            originalElement.replaceWith(placeholder);

            // Manually mark as placeholder (simulating internal state)
            // @ts-ignore - accessing private for testing
            virtualScroll._skeletonTracker.add('2', 1, 100, placeholder);
            // @ts-ignore - accessing private for testing
            virtualScroll._componentStateCache.set('2', {expanded: true});

            // Update message 2 with new content
            const updatedMessages = [
                createMessage('1', 'Message 1'),
                createMessage('2', 'Message 2 - UPDATED'),
                createMessage('3', 'Message 3'),
            ];

            virtualScroll.updateItems(updatedMessages);

            // Verify data model was updated
            // @ts-ignore - accessing private for testing
            expect(virtualScroll._items[1].content).toBe('Message 2 - UPDATED');

            // Verify cached state was invalidated
            // @ts-ignore - accessing private for testing
            expect(virtualScroll._componentStateCache.has('2')).toBe(false);

            // Verify DOM was NOT updated (still skeleton)
            expect((innerContainer.children[1] as HTMLElement).dataset.isSkeleton).toBe('true');
        });

        it('should update DOM when item is not a placeholder', () => {
            const messages = [
                createMessage('1', 'Message 1'),
                createMessage('2', 'Message 2'),
            ];

            virtualScroll = new MessageVirtualScroll<TestMessage>({
                scrollContainer,
                innerContainer,
                renderItem: createRenderFn(),
                getItemId: (item) => item.id,
                updateItemElement: createUpdateFn(),
            });

            virtualScroll.setItems(messages);

            // Update message 2
            const updatedMessages = [
                createMessage('1', 'Message 1'),
                createMessage('2', 'Message 2 - UPDATED'),
            ];

            virtualScroll.updateItems(updatedMessages);

            // Verify DOM was updated
            const element = innerContainer.children[1] as HTMLElement;
            expect(element.textContent).toBe('Message 2 - UPDATED');
        });

        it('should not update DOM when content is unchanged', () => {
            const messages = [
                createMessage('1', 'Message 1'),
                createMessage('2', 'Message 2'),
            ];

            const updateFn = vi.fn(createUpdateFn());

            virtualScroll = new MessageVirtualScroll<TestMessage>({
                scrollContainer,
                innerContainer,
                renderItem: createRenderFn(),
                getItemId: (item) => item.id,
                updateItemElement: updateFn,
            });

            virtualScroll.setItems(messages);

            // Update with identical content
            virtualScroll.updateItems(messages);

            // Verify update function was not called
            expect(updateFn).not.toHaveBeenCalled();
        });
    });

    describe('updateItemById with placeholders', () => {
        it('should handle placeholder items correctly', () => {
            const messages = [
                createMessage('1', 'Message 1'),
                createMessage('2', 'Message 2'),
            ];

            virtualScroll = new MessageVirtualScroll<TestMessage>({
                scrollContainer,
                innerContainer,
                renderItem: createRenderFn(),
                getItemId: (item) => item.id,
                updateItemElement: createUpdateFn(),
            });

            virtualScroll.setItems(messages);

            // Simulate skeletonization
            const placeholder = document.createElement('div');
            placeholder.className = 'message-skeleton';
            placeholder.dataset.itemId = '2';
            placeholder.dataset.isSkeleton = 'true';
            placeholder.style.height = '100px';

            const originalElement = innerContainer.children[1] as HTMLElement;
            originalElement.replaceWith(placeholder);

            // @ts-ignore - accessing private for testing
            virtualScroll._skeletonTracker.add('2', 1, 100, placeholder);
            // @ts-ignore - accessing private for testing
            virtualScroll._componentStateCache.set('2', {expanded: true});

            // Update by ID
            const result = virtualScroll.updateItemById('2', createMessage('2', 'Message 2 - UPDATED'));

            expect(result).toBe(true);

            // Verify data model was updated
            // @ts-ignore - accessing private for testing
            expect(virtualScroll._items[1].content).toBe('Message 2 - UPDATED');

            // Verify cached state was invalidated
            // @ts-ignore - accessing private for testing
            expect(virtualScroll._componentStateCache.has('2')).toBe(false);

            // Verify DOM was NOT updated (still skeleton)
            expect((innerContainer.children[1] as HTMLElement).dataset.isSkeleton).toBe('true');
        });

        it('should update DOM for non-placeholder items', () => {
            const messages = [
                createMessage('1', 'Message 1'),
                createMessage('2', 'Message 2'),
            ];

            virtualScroll = new MessageVirtualScroll<TestMessage>({
                scrollContainer,
                innerContainer,
                renderItem: createRenderFn(),
                getItemId: (item) => item.id,
                updateItemElement: createUpdateFn(),
            });

            virtualScroll.setItems(messages);

            const result = virtualScroll.updateItemById('2', createMessage('2', 'Message 2 - UPDATED'));

            expect(result).toBe(true);

            const element = innerContainer.children[1] as HTMLElement;
            expect(element.textContent).toBe('Message 2 - UPDATED');
        });
    });
});

describe('MessageVirtualScroll - Phase 5: Performance', () => {
    let scrollContainer: HTMLElement;
    let innerContainer: HTMLElement;
    let virtualScroll: MessageVirtualScroll<TestMessage>;

    beforeEach(() => {
        scrollContainer = document.createElement('div');
        scrollContainer.style.height = '500px';
        scrollContainer.style.overflow = 'auto';

        innerContainer = document.createElement('div');
        scrollContainer.appendChild(innerContainer);

        document.body.appendChild(scrollContainer);
    });

    afterEach(() => {
        virtualScroll?.dispose();
        document.body.removeChild(scrollContainer);
    });

    it('should handle large batch updates efficiently', () => {
        const messages = Array.from({length: 100}, (_, i) =>
            createMessage(`msg-${i}`, `Message ${i}`)
        );

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
        });

        virtualScroll.setItems(messages);

        const startTime = performance.now();

        // Update all messages
        const updatedMessages = messages.map((msg, i) =>
            createMessage(msg.id, `Message ${i} - UPDATED`)
        );

        virtualScroll.updateItems(updatedMessages);

        const duration = performance.now() - startTime;

        // Should complete in reasonable time (< 100ms for 100 items)
        expect(duration).toBeLessThan(100);
    });

    it('should skip unchanged items during update', () => {
        const messages = Array.from({length: 50}, (_, i) =>
            createMessage(`msg-${i}`, `Message ${i}`)
        );

        const updateFn = vi.fn(createUpdateFn());

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: updateFn,
        });

        virtualScroll.setItems(messages);

        // Update only 5 items
        const updatedMessages = [...messages];
        for (let i = 0; i < 5; i++) {
            updatedMessages[i] = createMessage(`msg-${i}`, `Message ${i} - UPDATED`);
        }

        virtualScroll.updateItems(updatedMessages);

        // Update function should only be called 5 times
        expect(updateFn).toHaveBeenCalledTimes(5);
    });

    it('should maintain performance with many placeholders', () => {
        const messages = Array.from({length: 100}, (_, i) =>
            createMessage(`msg-${i}`, `Message ${i}`)
        );

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
        });

        virtualScroll.setItems(messages);

        // Skeletonize 50 items
        for (let i = 0; i < 50; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'message-skeleton';
            placeholder.dataset.itemId = `msg-${i}`;
            placeholder.dataset.isSkeleton = 'true';
            placeholder.style.height = '100px';

            const originalElement = innerContainer.children[i] as HTMLElement;
            originalElement.replaceWith(placeholder);

            // @ts-ignore - accessing private for testing
            virtualScroll._skeletonTracker.add(`msg-${i}`, i, i * 100, placeholder);
        }

        const startTime = performance.now();

        // Update all messages
        const updatedMessages = messages.map((msg, i) =>
            createMessage(msg.id, `Message ${i} - UPDATED`)
        );

        virtualScroll.updateItems(updatedMessages);

        const duration = performance.now() - startTime;

        // Should still be fast even with many placeholders
        expect(duration).toBeLessThan(100);
    });
});

describe('MessageVirtualScroll - Phase 5: Edge Cases', () => {
    let scrollContainer: HTMLElement;
    let innerContainer: HTMLElement;
    let virtualScroll: MessageVirtualScroll<TestMessage>;

    beforeEach(() => {
        scrollContainer = document.createElement('div');
        scrollContainer.style.height = '500px';
        scrollContainer.style.overflow = 'auto';

        innerContainer = document.createElement('div');
        scrollContainer.appendChild(innerContainer);

        document.body.appendChild(scrollContainer);
    });

    afterEach(() => {
        virtualScroll?.dispose();
        document.body.removeChild(scrollContainer);
    });

    it('should handle update when element is not in DOM', () => {
        const messages = [
            createMessage('1', 'Message 1'),
            createMessage('2', 'Message 2'),
        ];

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
        });

        virtualScroll.setItems(messages);

        // Remove element from DOM
        const element = innerContainer.children[1] as HTMLElement;
        element.remove();

        // Should not throw
        const result = virtualScroll.updateItemById('2', createMessage('2', 'Message 2 - UPDATED'));

        // Data model should still be updated
        expect(result).toBe(true);
        // @ts-ignore - accessing private for testing
        expect(virtualScroll._items[1].content).toBe('Message 2 - UPDATED');
    });

    it('should handle update for non-existent item', () => {
        const messages = [
            createMessage('1', 'Message 1'),
        ];

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
        });

        virtualScroll.setItems(messages);

        const result = virtualScroll.updateItemById('non-existent', createMessage('non-existent', 'Test'));

        expect(result).toBe(false);
    });

    it('should handle empty update array', () => {
        const messages = [
            createMessage('1', 'Message 1'),
        ];

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
        });

        virtualScroll.setItems(messages);

        // Should not throw
        expect(() => virtualScroll.updateItems([])).not.toThrow();
    });

    it('should handle rapid consecutive updates', () => {
        const messages = [
            createMessage('1', 'Message 1'),
        ];

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
        });

        virtualScroll.setItems(messages);

        // Rapid updates
        for (let i = 0; i < 10; i++) {
            virtualScroll.updateItemById('1', createMessage('1', `Message 1 - Update ${i}`));
        }

        // Final state should be correct
        // @ts-ignore - accessing private for testing
        expect(virtualScroll._items[0].content).toBe('Message 1 - Update 9');
    });

    it('should handle streaming messages correctly', () => {
        const messages = [
            createMessage('1', 'Message 1', true), // Streaming
        ];

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
            isItemStable: (item) => !item.streaming,
        });

        virtualScroll.setItems(messages);

        // Mark as active stream
        // @ts-ignore - accessing private for testing
        virtualScroll._activeStreams.add('1');

        // Update streaming message
        virtualScroll.updateItemById('1', createMessage('1', 'Message 1 - Streaming update', true));

        // Should update normally
        // @ts-ignore - accessing private for testing
        expect(virtualScroll._items[0].content).toBe('Message 1 - Streaming update');
    });
});

describe('MessageVirtualScroll - Phase 5: User Experience', () => {
    let scrollContainer: HTMLElement;
    let innerContainer: HTMLElement;
    let virtualScroll: MessageVirtualScroll<TestMessage>;

    beforeEach(() => {
        scrollContainer = document.createElement('div');
        scrollContainer.style.height = '500px';
        scrollContainer.style.overflow = 'auto';

        innerContainer = document.createElement('div');
        scrollContainer.appendChild(innerContainer);

        document.body.appendChild(scrollContainer);
    });

    afterEach(() => {
        virtualScroll?.dispose();
        document.body.removeChild(scrollContainer);
    });

    it('should preserve component state when updating non-placeholder items', () => {
        const messages = [
            createMessage('1', 'Message 1'),
        ];

        let savedState: Record<string, unknown> | null = null;

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
            extractComponentState: () => ({expanded: true}),
            injectComponentState: (_item, _el, state) => {
                savedState = state;
            },
        });

        virtualScroll.setItems(messages);

        // Update message
        virtualScroll.updateItemById('1', createMessage('1', 'Message 1 - UPDATED'));

        // State should be preserved (not extracted since not skeletonizing)
        expect(savedState).toBeNull();
    });

    it('should invalidate cached state when placeholder content changes', () => {
        const messages = [
            createMessage('1', 'Message 1'),
        ];

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
        });

        virtualScroll.setItems(messages);

        // Simulate skeletonization with cached state
        const placeholder = document.createElement('div');
        placeholder.className = 'message-skeleton';
        placeholder.dataset.itemId = '1';
        placeholder.dataset.isSkeleton = 'true';
        placeholder.style.height = '100px';

        const originalElement = innerContainer.children[0] as HTMLElement;
        originalElement.replaceWith(placeholder);

        // @ts-ignore - accessing private for testing
        virtualScroll._skeletonTracker.add('1', 0, 0, placeholder);
        // @ts-ignore - accessing private for testing
        virtualScroll._componentStateCache.set('1', {expanded: true});

        // Update content
        virtualScroll.updateItemById('1', createMessage('1', 'Message 1 - CHANGED'));

        // Cached state should be invalidated
        // @ts-ignore - accessing private for testing
        expect(virtualScroll._componentStateCache.has('1')).toBe(false);
    });

    it('should not invalidate cached state when placeholder content is unchanged', () => {
        const timestamp = Date.now();
        const messages = [
            {id: '1', content: 'Message 1', timestamp},
        ];

        // Use getChangeableContent to only compare content field (not timestamp)
        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
            updateItemElement: createUpdateFn(),
            getChangeableContent: (item) => item.content, // Only compare content
        });

        virtualScroll.setItems(messages);

        // Simulate skeletonization with cached state
        const placeholder = document.createElement('div');
        placeholder.className = 'message-skeleton';
        placeholder.dataset.itemId = '1';
        placeholder.dataset.isSkeleton = 'true';
        placeholder.style.height = '100px';

        const originalElement = innerContainer.children[0] as HTMLElement;
        originalElement.replaceWith(placeholder);

        // @ts-ignore - accessing private for testing
        virtualScroll._skeletonTracker.add('1', 0, 0, placeholder);
        // @ts-ignore - accessing private for testing
        virtualScroll._componentStateCache.set('1', {expanded: true});

        // Update with identical content (different timestamp, but content is same)
        virtualScroll.updateItemById('1', {id: '1', content: 'Message 1', timestamp: Date.now() + 1000});

        // Cached state should NOT be invalidated (content unchanged)
        // @ts-ignore - accessing private for testing
        expect(virtualScroll._componentStateCache.has('1')).toBe(true);
    });

    it('should check visibility via VisibilityManager', () => {
        const messages = [
            createMessage('1', 'Message 1'),
        ];

        virtualScroll = new MessageVirtualScroll<TestMessage>({
            scrollContainer,
            innerContainer,
            renderItem: createRenderFn(),
            getItemId: (item) => item.id,
        });

        virtualScroll.setItems(messages);

        // @ts-ignore - accessing private for testing
        const isContainerVisible = virtualScroll._isContainerVisible.bind(virtualScroll);

        // Initially visible (default state)
        expect(isContainerVisible()).toBe(true);

        // Set visibility to false
        virtualScroll.setVisibility(false);
        expect(isContainerVisible()).toBe(false);

        // Set visibility to true
        virtualScroll.setVisibility(true);
        expect(isContainerVisible()).toBe(true);
    });
});
