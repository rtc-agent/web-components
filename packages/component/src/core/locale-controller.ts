import { type ReactiveControllerHost } from 'lit';
import { ContextConsumer } from '@lit/context';
import { localeContext, sourceLocale, targetLocales } from './i18n.js';

/**
 * Wraps locale context consumption logic to reduce component boilerplate
 *
 * @example
 * ```typescript
 * @localized()
 * @customElement('rtc-settings')
 * export class RtcSettings extends LitElement {
 *   private _locale = new LocaleController(this);
 *
 *   render() {
 *     return html`<p>Current: ${this._locale.locale}</p>`;
 *   }
 * }
 * ```
 */
export class LocaleController {
  private _consumer: ContextConsumer<
    typeof localeContext,
    ReactiveControllerHost & HTMLElement
  >;

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this._consumer = new ContextConsumer(host, {
      context: localeContext,
      subscribe: true,
    });
  }

  get locale() {
    return this._consumer.value?.locale ?? sourceLocale;
  }

  get locales() {
    return this._consumer.value?.locales ?? [sourceLocale, ...targetLocales];
  }
}
