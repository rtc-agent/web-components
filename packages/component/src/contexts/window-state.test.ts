import { describe, expect, it } from 'vitest';
import type { WindowState, WindowStateActions } from '../types/index.js';
import { WindowStateContext } from './window-state.js';

describe('WindowStateContext', () => {
  it('should export a context key', () => {
    expect(WindowStateContext).toBeDefined();
  });

  it('should define a default state factory', () => {
    const state: WindowState = {
      mode: 'normal',
      position: { x: 0, y: 0 },
      size: { width: 420, height: 640 },
    };
    expect(state.mode).toBe('normal');
    expect(state.size.width).toBe(420);
  });

  it('should define actions interface shape', () => {
    const actions: WindowStateActions = {
      setMode: () => {},
      setPosition: () => {},
      setSize: () => {},
      maximize: () => {},
      minimize: () => {},
      restore: () => {},
    };
    expect(typeof actions.maximize).toBe('function');
    expect(typeof actions.restore).toBe('function');
  });
});
