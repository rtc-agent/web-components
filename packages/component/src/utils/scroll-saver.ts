/**
 * ScrollSaver - Preserves scroll position across DOM changes.
 * Directly ported from Telegram Web's ScrollSaver.
 *
 * Key concept:
 * 1. save(): Record visible elements and their positions
 * 2. DOM changes (prepend/append/delete)
 * 3. restore(): Find anchor element, calculate position delta, adjust scrollTop
 */

import {createLogger} from '@rtc-agent/client';

const log = createLogger('ScrollSaver');

export class ScrollSaver {
    private _container: HTMLElement;
    private _query: string;
    private _reverse: boolean; // true = prepend (load from top)

    private _scrollTop: number = 0;
    private _scrollHeight: number = 0;
    private _elements: {element: HTMLElement; rect: DOMRect}[] = [];

    constructor(container: HTMLElement, query: string = '.message', reverse: boolean = true) {
        this._container = container;
        this._query = query;
        this._reverse = reverse;
    }

    /**
     * Save current scroll state and visible elements.
     */
    save() {
        this._findElements();
        this._scrollTop = this._container.scrollTop;
        this._scrollHeight = this._container.scrollHeight;
    }

    /**
     * Restore scroll position after DOM changes.
     */
    restore() {
        const scrollTop = this._container.scrollTop;
        const scrollHeight = this._container.scrollHeight;

        if (this._elements.length === 0) {
            // No elements saved, scroll to end or start
            this._container.scrollTop = this._reverse ? scrollHeight : 0;
            log.debug(`restore: no elements, scrollTop → ${this._container.scrollTop}`);
            return;
        }

        // Get anchor element (first if reverse, last if not)
        const anchor = this._getAnchor();
        if (!anchor || !anchor.element.isConnected) {
            // Anchor removed, fallback to height delta
            const delta = scrollHeight - this._scrollHeight;
            this._container.scrollTop = this._scrollTop + delta;
            log.debug(`restore: anchor removed, fallback delta=${delta}, scrollTop → ${this._container.scrollTop}`);
            return;
        }

        const {element, rect} = anchor;
        const newRect = element.getBoundingClientRect();
        const containerRect = this._container.getBoundingClientRect();

        // Check if element is overflowing
        const isOverflowingTop = rect.top < containerRect.top;
        const isOverflowingBottom = rect.bottom > containerRect.bottom;

        // Determine which edge to use as reference
        let positionKey: 'top' | 'bottom' = this._reverse ? 'top' : 'bottom';
        if (this._reverse ? isOverflowingTop && !isOverflowingBottom : isOverflowingBottom && !isOverflowingTop) {
            positionKey = this._reverse ? 'bottom' : 'top';
        }

        const newPosition = newRect[positionKey];
        const position = rect[positionKey];

        log.debug(
            `restore: reverse=${this._reverse}, anchor=${element.dataset?.messageIndex ?? '?'}, ` +
            `positionKey=${positionKey}, position=${position}, newPosition=${newPosition}, ` +
            `diff=${newPosition - position}`
        );

        if (newPosition === position) {
            return; // No change needed
        }

        const diff = newPosition - position;
        if (Math.abs(diff) > 0.5) {
            this._container.scrollTop = scrollTop + diff;
            log.debug(`restore: adjusted scrollTop to ${this._container.scrollTop}`);
        }
    }

    private _findElements() {
        const containerRect = this._container.getBoundingClientRect();
        const elements = Array.from(this._container.querySelectorAll(this._query)) as HTMLElement[];
        this._elements = [];

        for (const element of elements) {
            const rect = element.getBoundingClientRect();
            // Check if element is visible in container
            const isVisible = rect.bottom > containerRect.top && rect.top < containerRect.bottom;

            if (isVisible) {
                this._elements.push({element, rect});
            } else if (this._elements.length > 0) {
                // We've passed the visible region, stop
                break;
            }
        }

        // Fallback: if no visible elements, use first element
        if (this._elements.length === 0 && elements.length > 0) {
            this._elements.push({
                element: elements[0],
                rect: elements[0].getBoundingClientRect(),
            });
        }
    }

    private _getAnchor(): {element: HTMLElement; rect: DOMRect} | null {
        if (this._elements.length === 0) return null;
        // If reverse (prepend), anchor is first element; otherwise last
        return this._elements[this._reverse ? 0 : this._elements.length - 1];
    }
}
