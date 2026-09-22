import {describe, it, expect} from 'vitest';
import {permissionChecker} from '@rtc-agent/persistence';

/**
 * Permission tests for the askUser tool.
 *
 * askUser is inherently interactive: the user's selection IS the tool result,
 * so it always requires the ask-user dialog regardless of mode (except bypass).
 */
describe('permissionChecker — askUser rules', () => {
  it('requires confirm in manual mode', () => {
    expect(permissionChecker.needsConfirm('askUser', 'manual')).toBe(true);
  });

  it('requires confirm in edit mode', () => {
    expect(permissionChecker.needsConfirm('askUser', 'edit')).toBe(true);
  });

  it('requires confirm in plan mode', () => {
    expect(permissionChecker.needsConfirm('askUser', 'plan')).toBe(true);
  });

  it('requires confirm in auto mode', () => {
    expect(permissionChecker.needsConfirm('askUser', 'auto')).toBe(true);
  });

  it('allows unconditionally in bypass mode', () => {
    expect(permissionChecker.isAllowed('askUser', 'bypass')).toBe(true);
    expect(permissionChecker.needsConfirm('askUser', 'bypass')).toBe(false);
  });
});

describe('permissionChecker — existing tools unchanged', () => {
  it('ls/read/find/grep are always allowed in edit/manual', () => {
    for (const tool of ['ls', 'read', 'find', 'grep'] as const) {
      expect(permissionChecker.isAllowed(tool, 'edit')).toBe(true);
      expect(permissionChecker.isAllowed(tool, 'manual')).toBe(true);
    }
  });

  it('write requires confirm only in manual mode', () => {
    expect(permissionChecker.needsConfirm('write', 'manual')).toBe(true);
    expect(permissionChecker.needsConfirm('write', 'edit')).toBe(false);
  });

  it('script requires confirm in all non-bypass modes', () => {
    expect(permissionChecker.needsConfirm('script', 'manual')).toBe(true);
    expect(permissionChecker.needsConfirm('script', 'edit')).toBe(true);
    expect(permissionChecker.needsConfirm('script', 'plan')).toBe(true);
    expect(permissionChecker.needsConfirm('script', 'auto')).toBe(true);
    expect(permissionChecker.isAllowed('script', 'bypass')).toBe(true);
  });
});
