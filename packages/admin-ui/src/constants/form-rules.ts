/**
 * Common form validation rules
 *
 * Provides reusable validation rule factories and predefined rules for forms.
 * Supports i18n through message formatter pattern.
 *
 * Usage:
 * - With i18n: `getRequiredRule(intl.formatMessage, { id: '...', defaultMessage: '...' })`
 * - Without i18n: `FORM_RULES.required`
 */

import type { Rule } from 'antd/es/form';

/**
 * Message descriptor type - matches react-intl MessageDescriptor
 */
export interface MessageDescriptor {
  id: string;
  defaultMessage?: string;
}

/**
 * Message formatter type - matches intl.formatMessage signature
 * Uses 'any' for values to be compatible with react-intl's PrimitiveType
 */
export type MessageFormatter = (
  descriptor: MessageDescriptor,
  values?: Record<string, any>,
) => string;

// ============================================================================
// i18n-aware Rule Factories
// ============================================================================

/**
 * Required field validation rule factory
 */
export const getRequiredRule = (
  formatMessage: MessageFormatter,
  messageDescriptor: { id: string; defaultMessage: string },
): Rule => ({
  required: true,
  message: formatMessage(messageDescriptor),
});

/**
 * Whitespace validation rule factory
 * Prevents input of only spaces
 */
export const getWhitespaceRule = (
  formatMessage: MessageFormatter,
  messageDescriptor: { id: string; defaultMessage: string },
): Rule => ({
  whitespace: true,
  message: formatMessage(messageDescriptor),
});

/**
 * Max length validation rule factory
 */
export const getMaxLengthRule = (
  max: number,
  formatMessage: MessageFormatter,
  messageDescriptor: { id: string; defaultMessage: string },
): Rule => ({
  max,
  message: formatMessage(messageDescriptor, { max }),
});

/**
 * Min length validation rule factory
 */
export const getMinLengthRule = (
  min: number,
  formatMessage: MessageFormatter,
  messageDescriptor: { id: string; defaultMessage: string },
): Rule => ({
  min,
  message: formatMessage(messageDescriptor, { min }),
});

/**
 * Pattern validation rule factory
 */
export const getPatternRule = (
  pattern: RegExp,
  formatMessage: MessageFormatter,
  messageDescriptor: { id: string; defaultMessage: string },
): Rule => ({
  pattern,
  message: formatMessage(messageDescriptor),
});

/**
 * Email validation rule factory
 */
export const getEmailRule = (
  formatMessage: MessageFormatter,
  messageDescriptor: { id: string; defaultMessage: string },
): Rule => ({
  type: 'email',
  message: formatMessage(messageDescriptor),
});

// ============================================================================
// Predefined Rule Sets (i18n-aware)
// ============================================================================

/**
 * Text field rules factory
 * Combines required + whitespace + max length
 */
export const getTextFieldRules = (
  formatMessage: MessageFormatter,
  options: {
    requiredMessage: { id: string; defaultMessage: string };
    whitespaceMessage: { id: string; defaultMessage: string };
    maxLengthMessage: { id: string; defaultMessage: string };
    maxLength: number;
    required?: boolean;
  },
): Rule[] => {
  const { required = true } = options;
  const rules: Rule[] = [];

  if (required) {
    rules.push(getRequiredRule(formatMessage, options.requiredMessage));
  }
  rules.push(getWhitespaceRule(formatMessage, options.whitespaceMessage));
  rules.push(getMaxLengthRule(options.maxLength, formatMessage, options.maxLengthMessage));

  return rules;
};

/**
 * Text area rules factory
 * Same as text field but typically with larger max length
 */
export const getTextAreaRules = getTextFieldRules;

// ============================================================================
// Predefined Rules (without i18n)
// ============================================================================

/**
 * Predefined validation rules without i18n
 * Use for quick prototyping or when i18n is not needed
 */
export const FORM_RULES = {
  /** Required field */
  required: {
    required: true,
    message: 'This field is required',
  } as Rule,

  /** Whitespace validation (prevents only spaces) */
  whitespace: {
    whitespace: true,
    message: 'This field cannot be only spaces',
  } as Rule,

  /** Required + whitespace combination */
  requiredWithWhitespace: [
    { required: true, message: 'This field is required' },
    { whitespace: true, message: 'This field cannot be only spaces' },
  ] as Rule[],

  /** Max length presets */
  maxLength: {
    50: (message?: string) =>
      ({
        max: 50,
        message: message ?? 'Cannot exceed 50 characters',
      }) as Rule,
    100: (message?: string) =>
      ({
        max: 100,
        message: message ?? 'Cannot exceed 100 characters',
      }) as Rule,
    200: (message?: string) =>
      ({
        max: 200,
        message: message ?? 'Cannot exceed 200 characters',
      }) as Rule,
    500: (message?: string) =>
      ({
        max: 500,
        message: message ?? 'Cannot exceed 500 characters',
      }) as Rule,
    1000: (message?: string) =>
      ({
        max: 1000,
        message: message ?? 'Cannot exceed 1000 characters',
      }) as Rule,
  },

  /** Common text field patterns */
  patterns: {
    /** English letters, numbers, underscores, must start with letter */
    identifier: {
      pattern: /^[a-z][a-z0-9_]*$/,
      message:
        'Can only contain lowercase letters, numbers, and underscores, and must start with a letter',
    } as Rule,

    /** Slug format (URL-safe) */
    slug: {
      pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      message: 'Can only contain lowercase letters, numbers, and hyphens',
    } as Rule,
  },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create rules array from multiple rule factories
 * Utility to flatten and filter undefined rules
 */
export const createRules = (...rules: (Rule | Rule[] | undefined)[]): Rule[] => {
  return rules.flat().filter((rule): rule is Rule => rule !== undefined);
};
