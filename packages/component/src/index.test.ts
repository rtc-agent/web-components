import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, fixture, nextFrame } from './test-helpers.js';

describe('Test Infrastructure', () => {
  afterEach(() => cleanupFixtures());

  it('should create a DOM element from a Lit template', async () => {
    const el = await fixture<HTMLDivElement>(html`<div id="test">hello</div>`);
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(el.id).toBe('test');
    expect(el.textContent).toBe('hello');
  });

  it('should wait for next animation frame', async () => {
    let called = false;
    requestAnimationFrame(() => {
      called = true;
    });
    await nextFrame();
    expect(called).toBe(true);
  });
});
