import {describe, it, expect, vi} from 'vitest';
import {ToolCallController} from './tool-call.controller.js';

class MockHost {
    updateCount = 0;
    dispatchEvent = vi.fn();
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('ToolCallController', () => {
    it('should have empty pending calls by default', () => {
        const host = new MockHost();
        const ctrl = new ToolCallController(host as any);
        expect(ctrl.value.state.pendingCalls).toEqual([]);
    });

    it('should approve a tool call by id', () => {
        const host = new MockHost();
        const ctrl = new ToolCallController(host as any);
        ctrl.addPendingCall({
            id: 'tc-1',
            toolName: 'Bash',
            command: 'ls',
            status: 'pending',
        });
        ctrl.actions.approve('tc-1');
        // approve() removes the call from pendingCalls (it is no longer pending)
        expect(ctrl.value.state.pendingCalls).toHaveLength(0);
    });

    it('should approve all tool calls for a given tool name', () => {
        const host = new MockHost();
        const ctrl = new ToolCallController(host as any);
        ctrl.addPendingCall({id: 'tc-1', toolName: 'Bash', status: 'pending'});
        ctrl.addPendingCall({id: 'tc-2', toolName: 'Bash', status: 'pending'});
        ctrl.addPendingCall({id: 'tc-3', toolName: 'Write', status: 'pending'});
        ctrl.actions.approveAll('Bash');
        // approveAll() removes all matching calls from pendingCalls
        const calls = ctrl.value.state.pendingCalls;
        expect(calls).toHaveLength(1);
        expect(calls[0].toolName).toBe('Write');
    });

    it('should deny a tool call', () => {
        const host = new MockHost();
        const ctrl = new ToolCallController(host as any);
        ctrl.addPendingCall({id: 'tc-1', toolName: 'Bash', status: 'pending'});
        ctrl.actions.deny('tc-1');
        // deny() removes the call from pendingCalls
        expect(ctrl.value.state.pendingCalls).toHaveLength(0);
    });

    it('should dispatch rtc-tool-call-approved on approve', () => {
        const host = new MockHost();
        const ctrl = new ToolCallController(host as any);
        ctrl.addPendingCall({id: 'tc-1', toolName: 'Bash', status: 'pending'});
        ctrl.actions.approve('tc-1');
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-tool-call-approved'})
        );
    });

    it('should dispatch rtc-tool-call-denied on deny', () => {
        const host = new MockHost();
        const ctrl = new ToolCallController(host as any);
        ctrl.addPendingCall({id: 'tc-1', toolName: 'Bash', status: 'pending'});
        ctrl.actions.deny('tc-1');
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-tool-call-denied'})
        );
    });
});
