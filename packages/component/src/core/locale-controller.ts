import { type ReactiveController, type ReactiveControllerHost } from 'lit';
import { ContextConsumer } from '@lit/context';
import { localeContext, sourceLocale, targetLocales } from './i18n.js';

/**
 * 封装 locale context 消费逻辑，减少组件样板代码
 *
 * @example
 * ```typescript
 * @localized()
 * @customElement('rtc-settings')
 * export class RtcSettings extends LitElement {
 *   private _locale = new LocaleController(this);
 *
 *   render() {
 *     return html`<p>当前: ${this._locale.locale}</p>`;
 *   }
 * }
 * ```
 */
export class LocaleController implements ReactiveController {
  private _consumer: ContextConsumer<typeof localeContext, ReactiveControllerHost & HTMLElement>;

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this._consumer = new ContextConsumer(host, {
      context: localeContext,
      subscribe: true,
    });
    host.addController(this);
  }

  get locale() {
    return this._consumer.value?.locale ?? sourceLocale;
  }

  get locales() {
    return this._consumer.value?.locales ?? [sourceLocale, ...targetLocales];
  }

  hostUpdated() {
    // Context 值变化时自动触发重渲染
  }
}
