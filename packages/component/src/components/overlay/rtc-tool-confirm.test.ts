import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupFixtures, fixture, nextFrame } from '../../test-helpers.js';
import './rtc-tool-confirm.js';
import type { ToolCall } from '../../types/index.js';

const mockToolCall: ToolCall = {
  id: 'tc-1',
  tool_name: 'file-write',
  input: JSON.stringify({ path: '/test.txt', content: 'hello' }),
};

describe('<rtc-tool-confirm>', () => {
  afterEach(() => cleanupFixtures());

  it('should render with shadow DOM', async () => {
    const el = await fixture<HTMLElement>(
      html`<rtc-tool-confirm .toolCall=${mockToolCall}></rtc-tool-confirm>`,
    );
    expect(el.shadowRoot).not.toBeNull();
  });

  it('should display tool name', async () => {
    const el = await fixture<HTMLElement>(
      html`<rtc-tool-confirm .toolCall=${mockToolCall}></rtc-tool-confirm>`,
    );
    await nextFrame();
    // Tool name is formatted: "file-write" becomes "File Write"
    expect(el.shadowRoot?.textContent).toContain('File Write');
  });

  it('should display parameter summary', async () => {
    const el = await fixture<HTMLElement>(
      html`<rtc-tool-confirm .toolCall=${mockToolCall}></rtc-tool-confirm>`,
    );
    await nextFrame();
    expect(el.shadowRoot?.textContent).toContain('/test.txt');
  });

  it('should have Yes, No buttons', async () => {
    const el = await fixture<HTMLElement>(
      html`<rtc-tool-confirm .toolCall=${mockToolCall}></rtc-tool-confirm>`,
    );
    await nextFrame();
    expect(el.shadowRoot?.querySelector('[data-action="yes"]')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('[data-action="no"]')).not.toBeNull();
  });

  it('should dispatch rtc-tool-call-approved on Yes click', async () => {
    const el = await fixture<HTMLElement>(
      html`<rtc-tool-confirm .toolCall=${mockToolCall}></rtc-tool-confirm>`,
    );
    await nextFrame();
    const handler = vi.fn();
    el.addEventListener('rtc-tool-call-approved', handler);
    const yesBtn = el.shadowRoot!.querySelector(
      '[data-action="yes"]',
    ) as HTMLElement;
    yesBtn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.toolCallId).toBe('tc-1');
  });

  it('should dispatch rtc-tool-call-denied on No click', async () => {
    const el = await fixture<HTMLElement>(
      html`<rtc-tool-confirm .toolCall=${mockToolCall}></rtc-tool-confirm>`,
    );
    await nextFrame();
    const handler = vi.fn();
    el.addEventListener('rtc-tool-call-denied', handler);
    const noBtn = el.shadowRoot!.querySelector(
      '[data-action="no"]',
    ) as HTMLElement;
    noBtn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.toolCallId).toBe('tc-1');
  });

  it('should show backdrop overlay', async () => {
    const el = await fixture<HTMLElement>(
      html`<rtc-tool-confirm .toolCall=${mockToolCall}></rtc-tool-confirm>`,
    );
    await nextFrame();
    const backdrop = el.shadowRoot?.querySelector('.backdrop');
    expect(backdrop).not.toBeNull();
  });
});
