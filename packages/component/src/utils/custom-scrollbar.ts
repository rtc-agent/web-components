/**
 * Custom Scrollbar - Ported from Telegram Web
 *
 * Provides a custom scrollbar that doesn't jump when content is prepended.
 * Uses thumb + thumbContainer pattern.
 */

import { createLogger } from '@rtc-agent/client';

const log = createLogger('CustomScrollbar');

export class CustomScrollbar {
    private _container: HTMLElement;
    private _thumbContainer: HTMLElement;
    private _thumb: HTMLElement;

    private _startMousePosition: number = 0;
    private _startScrollPosition: number = 0;

    private _onMouseMove: (e: MouseEvent) => void;
    private _onMouseDown: (e: MouseEvent) => void;
    private _onMouseUp: (e: MouseEvent) => void;
    private _onScroll: () => void;

    constructor(container: HTMLElement) {
        this._container = container;

        // Create thumb container and thumb
        this._thumbContainer = document.createElement('div');
        this._thumbContainer.className = 'custom-scrollbar-thumb-container';
        this._thumb = document.createElement('div');
        this._thumb.className = 'custom-scrollbar-thumb';
        this._thumbContainer.appendChild(this._thumb);

        // Prepend to container
        this._container.prepend(this._thumbContainer);

        // Bind handlers
        this._onMouseMove = this._handleMouseMove.bind(this);
        this._onMouseDown = this._handleMouseDown.bind(this);
        this._onMouseUp = this._handleMouseUp.bind(this);
        this._onScroll = this._handleScroll.bind(this);

        // Add listeners
        this._thumb.addEventListener('mousedown', this._onMouseDown);
        this._container.addEventListener('scroll', this._onScroll, {passive: true});

        // Initial update
        this.updateThumb();
    }

    /**
     * Update thumb position and size based on scroll position.
     */
    updateThumb(scrollPosition: number = this._container.scrollTop) {
        const scrollSize = this._container.scrollHeight;
        const clientSize = this._container.clientHeight;
        const divider = scrollSize / clientSize / 0.75;
        const thumbSize = Math.max(20, clientSize / divider);
        const value = (scrollPosition / (scrollSize - clientSize)) * clientSize;
        const b = scrollPosition / (scrollSize - clientSize);
        const maxValue = clientSize - thumbSize;

        log.debug(`scrollPosition=${scrollPosition}, scrollSize=${scrollSize}, clientSize=${clientSize}, thumbSize=${thumbSize}, value=${value}, b=${b}, maxValue=${maxValue}`);

        if (clientSize < scrollSize) {
            this._thumb.style.height = `${thumbSize}px`;
            this._thumb.style.transform = `translateY(${Math.min(maxValue, value - thumbSize * b)}px)`;
            log.debug(`Applied transform: translateY(${Math.min(maxValue, value - thumbSize * b)}px)`);
        } else {
            this._thumb.style.height = '0px';
        }
    }

    /**
     * Call this when content size changes.
     */
    onSizeChange() {
        this.updateThumb();
    }

    /**
     * Clean up event listeners.
     */
    destroy() {
        this._thumb.removeEventListener('mousedown', this._onMouseDown);
        this._container.removeEventListener('scroll', this._onScroll);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
    }

    private _handleScroll() {
        this.updateThumb();
    }

    private _handleMouseDown(e: MouseEvent) {
        e.preventDefault();
        this._startMousePosition = e.clientY;
        this._startScrollPosition = this._container.scrollTop;
        this._thumb.classList.add('is-focused');

        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp, {once: true});
    }

    private _handleMouseMove(e: MouseEvent) {
        e.preventDefault();

        const contentHeight = this._container.scrollHeight;
        const viewportHeight = this._container.clientHeight;
        const scrollbarSize = this._thumb.offsetHeight;
        const maxScrollTop = contentHeight - viewportHeight;
        const maxScrollbarOffset = viewportHeight - scrollbarSize;

        const deltaY = e.clientY - this._startMousePosition;
        const scrollAmount = (deltaY / maxScrollbarOffset) * maxScrollTop;
        const newScrollTop = this._startScrollPosition + scrollAmount;

        this._container.scrollTop = newScrollTop;
    }

    private _handleMouseUp(_e: MouseEvent) {
        window.removeEventListener('mousemove', this._onMouseMove);
        this._thumb.classList.remove('is-focused');
    }
}
