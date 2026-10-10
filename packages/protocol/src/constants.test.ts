import { describe, it, expect } from 'vitest';
import { RpcMethod, RpcErrorCode } from './index.js';

describe('RpcMethod constants', () => {
  it('should have all Session methods', () => {
    expect(RpcMethod.SessionList).toBe('v1.session.list');
    expect(RpcMethod.SessionGet).toBe('v1.session.get');
    expect(RpcMethod.SessionClose).toBe('v1.session.close');
    expect(RpcMethod.SessionOpen).toBe('v1.session.open');
    expect(RpcMethod.SessionUpdate).toBe('v1.session.update');
    expect(RpcMethod.SessionFork).toBe('v1.session.fork');
    expect(RpcMethod.SessionCompact).toBe('v1.session.compact');
  });

  it('should have all Message methods', () => {
    expect(RpcMethod.MessageSend).toBe('v1.message.send');
    expect(RpcMethod.MessageList).toBe('v1.message.list');
    expect(RpcMethod.MessageGet).toBe('v1.message.get');
  });

  it('should have all Turn methods', () => {
    expect(RpcMethod.TurnList).toBe('v1.turn.list');
    expect(RpcMethod.TurnGet).toBe('v1.turn.get');
    expect(RpcMethod.TurnStop).toBe('v1.turn.stop');
  });

  it('should have all RTC methods', () => {
    expect(RpcMethod.RtcList).toBe('v1.rtc.list');
    expect(RpcMethod.RtcGet).toBe('v1.rtc.get');
    expect(RpcMethod.RtcUpdateStatus).toBe('v1.rtc.update_status');
    expect(RpcMethod.RtcSubmitResult).toBe('v1.rtc.submit_result');
  });

  it('should have correct total number of methods', () => {
    const methodCount = Object.keys(RpcMethod).length;
    expect(methodCount).toBe(17); // 7 Session + 3 Message + 3 Turn + 4 RTC
  });

  it('should have unique method values', () => {
    const values = Object.values(RpcMethod);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('should follow naming convention (v1.<resource>.<action>)', () => {
    Object.values(RpcMethod).forEach((method) => {
      expect(method).toMatch(/^v1\.\w+\.\w+$/);
    });
  });
});

describe('RpcErrorCode constants', () => {
  it('should have general error codes', () => {
    expect(RpcErrorCode.InvalidRequest).toBe(100);
    expect(RpcErrorCode.InternalError).toBe(101);
  });

  it('should have idempotency conflict error code', () => {
    expect(RpcErrorCode.ClientIdConflict).toBe(200);
  });

  it('should have correct total number of error codes', () => {
    const errorCodeCount = Object.keys(RpcErrorCode).length;
    expect(errorCodeCount).toBe(3);
  });

  it('should have unique error code values', () => {
    const values = Object.values(RpcErrorCode);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('should have error codes in correct ranges', () => {
    // General errors: 100-199
    expect(RpcErrorCode.InvalidRequest).toBeGreaterThanOrEqual(100);
    expect(RpcErrorCode.InvalidRequest).toBeLessThan(200);
    expect(RpcErrorCode.InternalError).toBeGreaterThanOrEqual(100);
    expect(RpcErrorCode.InternalError).toBeLessThan(200);

    // Idempotency conflicts: 200-299
    expect(RpcErrorCode.ClientIdConflict).toBeGreaterThanOrEqual(200);
    expect(RpcErrorCode.ClientIdConflict).toBeLessThan(300);
  });
});
