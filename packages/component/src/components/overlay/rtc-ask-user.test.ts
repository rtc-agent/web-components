import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-ask-user.js';
import type {RtcAskUser} from './rtc-ask-user.js';
import type {LocalRtc} from '@rtc-agent/persistence';

/**
 * Build a minimal LocalRtc-shaped mock with the ask_user parameters.
 * Only the fields the component actually reads are set.
 */
function makeRtc(questions: unknown[]): LocalRtc {
    return {
        client_id: 'rtc-ask-1',
        session_client_id: 'sess-1',
        sync_status: 'pending',
        tool_name: 'ask_user',
        status: 'pending',
        turn_id: 'turn-1',
        offset: 0,
        parameters: {questions},
    } as unknown as LocalRtc;
}

/**
 * Click an element and wait for Lit's state update + render cycle to flush.
 * Single nextFrame() is insufficient — @state mutations schedule a microtask
 * update that needs updateComplete to resolve before the DOM reflects.
 */
async function clickAndWait(el: RtcAskUser, target: Element) {
    (target as HTMLElement).click();
    await el.updateComplete;
    await nextFrame();
}

const singleQ = [
    {
        question: 'Which auth method?',
        header: 'Auth',
        multiSelect: false,
        options: [
            {label: 'OAuth 2.0', description: 'Industry standard (Recommended)'},
            {label: 'API Key', description: 'Simple server-to-server'},
        ],
    },
];

const multiQ = [
    {
        question: 'Auth?',
        header: 'Auth',
        multiSelect: false,
        options: [{label: 'OAuth', description: 'Standard'}],
    },
    {
        question: 'Library?',
        header: 'Lib',
        multiSelect: false,
        options: [{label: 'Day.js', description: 'Light'}],
    },
];

describe('<rtc-ask-user>', () => {
    afterEach(() => cleanupFixtures());

    // ──────────────────── Shell / Title ────────────────────

    it('renders a dialog with shadow DOM', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        expect(el.shadowRoot).not.toBeNull();
        expect(el.shadowRoot!.querySelector('.dialog')).not.toBeNull();
    });

    it('shows "Answer a question" (singular) for a single question', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('.dialog-title')!.textContent).toBe('Answer a question');
    });

    it('shows "Answer N questions" (plural) for multiple questions', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(multiQ)}></rtc-ask-user>`
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('.dialog-title')!.textContent).toBe('Answer 2 questions');
    });

    // ──────────────────── Hybrid mode: tab vs no-tab ────────────────────

    it('hides the tab bar for a single question', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('.tab-bar')).toBeNull();
    });

    it('shows the tab bar for multiple questions', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(multiQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const chips = el.shadowRoot!.querySelectorAll('.tab-chip');
        expect(chips.length).toBe(2);
        expect(chips[0].textContent!.trim()).toBe('Auth');
        expect(chips[1].textContent!.trim()).toBe('Lib');
    });

    it('adds the "multi" class to the dialog for multiple questions', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(multiQ)}></rtc-ask-user>`
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('.dialog')!.classList.contains('multi')).toBe(true);
    });

    // ──────────────────── Question rendering ────────────────────

    it('renders the question header chip and question text', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('.chip')!.textContent!.trim()).toBe('Auth');
        expect(el.shadowRoot!.querySelector('.question-text')!.textContent).toContain('Which auth method?');
    });

    it('renders one option card per option, plus an auto-appended Other', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const options = el.shadowRoot!.querySelectorAll('.option');
        const otherWrapper = el.shadowRoot!.querySelector('.option-wrapper');
        // 2 real options + 1 auto-appended Other (in wrapper)
        expect(options.length).toBe(3);
        expect(otherWrapper).not.toBeNull();
        expect(otherWrapper!.querySelector('.option.other')).not.toBeNull();
        expect(otherWrapper!.textContent).toContain('Other');
    });

    it('renders the (Recommended) tag when present in description', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const rec = el.shadowRoot!.querySelector('.rec');
        expect(rec).not.toBeNull();
        expect(rec!.textContent).toBe('(Recommended)');
    });

    // ──────────────────── Selection ────────────────────

    it('selects an option on click (single-select replaces)', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const options = el.shadowRoot!.querySelectorAll('.option');
        // Click first option (OAuth)
        await clickAndWait(el, options[0]);
        expect(options[0].classList.contains('selected')).toBe(true);
        expect(options[1].classList.contains('selected')).toBe(false);
        // Click second option (API Key) — should replace
        await clickAndWait(el, options[1]);
        expect(options[0].classList.contains('selected')).toBe(false);
        expect(options[1].classList.contains('selected')).toBe(true);
    });

    it('toggles multi-select options', async () => {
        const multiSelQ = [{
            question: 'Features?',
            header: 'Feat',
            multiSelect: true,
            options: [
                {label: 'A', description: 'a'},
                {label: 'B', description: 'b'},
            ],
        }];
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(multiSelQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const options = el.shadowRoot!.querySelectorAll('.option');
        await clickAndWait(el, options[0]);
        await clickAndWait(el, options[1]);
        expect(options[0].classList.contains('selected')).toBe(true);
        expect(options[1].classList.contains('selected')).toBe(true);
        // Toggle off
        await clickAndWait(el, options[0]);
        expect(options[0].classList.contains('selected')).toBe(false);
        expect(options[1].classList.contains('selected')).toBe(true);
    });

    // ──────────────────── Other input ────────────────────

    it('shows the text input only when Other is selected', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const wrapper = el.shadowRoot!.querySelector('.option-wrapper') as HTMLElement;
        const other = wrapper.querySelector('.option.other') as HTMLElement;
        expect(wrapper.querySelector('.other-input')).toBeNull();
        await clickAndWait(el, other);
        expect(wrapper.querySelector('.other-input')).not.toBeNull();
    });

    it('allows typing in the Other input without deselecting', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        // Select Other
        const wrapper = el.shadowRoot!.querySelector('.option-wrapper') as HTMLElement;
        const other = wrapper.querySelector('.option.other') as HTMLElement;
        await clickAndWait(el, other);
        expect(wrapper.classList.contains('selected')).toBe(true);
        const input = wrapper.querySelector('.other-input') as HTMLInputElement;
        // Click on the input (should not deselect Other)
        await clickAndWait(el, input);
        expect(wrapper.classList.contains('selected')).toBe(true);
        // Type text
        input.value = 'Custom answer';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await el.updateComplete;
        await nextFrame();
        // Verify the value is captured
        expect(el['_otherTexts'][0]).toBe('Custom answer');
    });

    // ──────────────────── Submit button state ────────────────────

    it('disables Submit until at least one answer is provided', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const submitBtn = el.shadowRoot!.querySelector('.action-btn.primary') as HTMLButtonElement;
        expect(submitBtn.disabled).toBe(true);
        // Select an option
        await clickAndWait(el, el.shadowRoot!.querySelector('.option')!);
        expect(submitBtn.disabled).toBe(false);
    });

    // ──────────────────── Submit event ────────────────────

    it('dispatches rtc-ask-user-submit with correct payload on Submit', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-ask-user-submit', handler);
        // Select OAuth (first option)
        await clickAndWait(el, el.shadowRoot!.querySelector('.option')!);
        (el.shadowRoot!.querySelector('.action-btn.primary') as HTMLElement).click();
        expect(handler).toHaveBeenCalledTimes(1);
        const detail = handler.mock.calls[0][0].detail;
        expect(detail.clientId).toBe('rtc-ask-1');
        expect(detail.payload.answers).toEqual({'Which auth method?': 'OAuth 2.0'});
        expect(detail.payload.metadata).toEqual({source: 'rtc-ask-user'});
    });

    it('includes Other free-text in answers when Other is selected', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-ask-user-submit', handler);
        // Select Other
        const wrapper = el.shadowRoot!.querySelector('.option-wrapper') as HTMLElement;
        const other = wrapper.querySelector('.option.other') as HTMLElement;
        await clickAndWait(el, other);
        const input = wrapper.querySelector('.other-input') as HTMLInputElement;
        input.value = 'LDAP';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await el.updateComplete;
        await nextFrame();
        (el.shadowRoot!.querySelector('.action-btn.primary') as HTMLElement).click();
        const answers = handler.mock.calls[0][0].detail.payload.answers;
        expect(answers['Which auth method?']).toBe('LDAP');
    });

    it('captures preview annotation from selected option', async () => {
        const qWithPreview = [{
            question: 'Auth?',
            header: 'Auth',
            multiSelect: false,
            options: [
                {label: 'OAuth', description: 'std', preview: 'const x = 1;'},
                {label: 'Key', description: 'simple'},
            ],
        }];
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(qWithPreview)}></rtc-ask-user>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-ask-user-submit', handler);
        await clickAndWait(el, el.shadowRoot!.querySelector('.option')!);
        (el.shadowRoot!.querySelector('.action-btn.primary') as HTMLElement).click();
        const payload = handler.mock.calls[0][0].detail.payload;
        expect(payload.annotations).toEqual({'Auth?': {preview: 'const x = 1;'}});
    });

    // ──────────────────── Dismiss ────────────────────

    it('dispatches rtc-ask-user-dismiss on Cancel click', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-ask-user-dismiss', handler);
        (el.shadowRoot!.querySelector('.action-btn.ghost') as HTMLElement).click();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.clientId).toBe('rtc-ask-1');
    });

    it('dispatches rtc-ask-user-dismiss on backdrop click', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-ask-user-dismiss', handler);
        (el.shadowRoot!.querySelector('.backdrop') as HTMLElement).click();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('dispatches dismiss on Escape key', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(singleQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-ask-user-dismiss', handler);
        el.shadowRoot!.querySelector('.dialog')!.dispatchEvent(
            new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})
        );
        expect(handler).toHaveBeenCalledTimes(1);
    });

    // ──────────────────── Multi-question navigation ────────────────────

    it('switches tabs on chip click', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(multiQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const chips = el.shadowRoot!.querySelectorAll('.tab-chip');
        const progress = () => el.shadowRoot!.querySelector('.progress')!.textContent;
        expect(progress()).toBe('Question 1 of 2');
        expect(chips[0].getAttribute('aria-selected')).toBe('true');
        await clickAndWait(el, chips[1]);
        expect(progress()).toBe('Question 2 of 2');
        expect(chips[1].getAttribute('aria-selected')).toBe('true');
    });

    it('Prev/Next buttons navigate and edge-disable correctly', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(multiQ)}></rtc-ask-user>`
        );
        await nextFrame();
        const prev = () => el.shadowRoot!.querySelector('.action-btn.ghost') as HTMLButtonElement;
        const next = () => el.shadowRoot!.querySelectorAll('.action-btn.ghost')[1] as HTMLButtonElement;

        // At first tab: Prev disabled
        expect(prev().disabled).toBe(true);
        // Next enabled
        expect(next().style.visibility).not.toBe('hidden');

        await clickAndWait(el, next());
        // At last tab: Next hidden
        expect(next().style.visibility).toBe('hidden');
        // Prev enabled
        expect(prev().disabled).toBe(false);
    });

    // ──────────────────── Preview panel ────────────────────

    it('renders the preview panel only when the selected option has preview', async () => {
        const qWithPreview = [{
            question: 'Auth?',
            header: 'Auth',
            multiSelect: false,
            options: [
                {label: 'OAuth', description: 'std', preview: 'const x = 1;'},
                {label: 'Key', description: 'simple'},
            ],
        }];
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc(qWithPreview)}></rtc-ask-user>`
        );
        await nextFrame();
        // Nothing selected → no preview
        expect(el.shadowRoot!.querySelector('.preview-panel')).toBeNull();
        // Select first option (has preview)
        await clickAndWait(el, el.shadowRoot!.querySelector('.option')!);
        const preview = el.shadowRoot!.querySelector('.preview-panel');
        expect(preview).not.toBeNull();
        expect(preview!.textContent).toContain('const x = 1;');
    });

    // ──────────────────── Empty RTC ────────────────────

    it('renders a minimal backdrop when RTC has no questions', async () => {
        const el = await fixture<RtcAskUser>(
            html`<rtc-ask-user .rtc=${makeRtc([])}></rtc-ask-user>`
        );
        await nextFrame();
        // No dialog card, just a backdrop
        expect(el.shadowRoot!.querySelector('.dialog')).toBeNull();
        expect(el.shadowRoot!.querySelector('.backdrop')).not.toBeNull();
    });
});
