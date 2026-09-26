import {createContext} from '@lit/context';

/**
 * Logo Context — custom logo for host application branding.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-logo>
 *
 * The context carries optional custom SVG/HTML strings for light and dark themes.
 * When both are absent, <rtc-logo> falls back to the default RTC Agent logo.
 */
export interface LogoContextValue {
    /** Custom logo SVG/HTML for light theme */
    light: string;
    /** Custom logo SVG/HTML for dark theme */
    dark: string;
}

export const LogoContext = createContext<LogoContextValue>(
    Symbol('logo-context')
);

/** Default — no custom logo (empty strings trigger fallback in <rtc-logo>). */
export const DEFAULT_LOGO: LogoContextValue = {
    light: '',
    dark: '',
};
