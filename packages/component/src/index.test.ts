import {describe, it, expect, afterEach} from 'vitest';
import {fixture, cleanupFixtures, nextFrame} from './test-helpers.js';
import {html} from 'lit';

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
