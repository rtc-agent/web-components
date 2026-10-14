/**
 * Common validation rules for forms
 *
 * Provides reusable validation rule factories that support i18n.
 * Usage: createRules(intl.formatMessage) or use factory functions directly
 */

import type { FormInstance } from 'antd';

/**
 * Message formatter type - matches intl.formatMessage signature
 */
type MessageFormatter = (
  descriptor: {
    id: string;
    defaultMessage: string;
  },
  values?: Record<string, any>,
) => string;

/**
 * Email validation rules factory
 */
export const getEmailRules = (
  formatMessage: MessageFormatter,
  options?: { required?: boolean; max?: number },
) => {
  const { required = true, max = 255 } = options || {};
  return [
    ...(required
      ? [
          {
            required: true,
            message: formatMessage({
              id: 'validation.email.required',
              defaultMessage: 'Email is required',
            }),
          },
        ]
      : []),
    {
      type: 'email' as const,
      message: formatMessage({
        id: 'validation.email.invalid',
        defaultMessage: 'Invalid email format',
      }),
    },
    {
      max,
      message: formatMessage(
        {
          id: 'validation.email.tooLong',
          defaultMessage: `Email cannot exceed ${max} characters`,
        },
        { max },
      ),
    },
  ];
};

/**
 * Password validation rules factory
 */
export const getPasswordRules = (
  formatMessage: MessageFormatter,
  options?: { required?: boolean; min?: number; max?: number },
) => {
  const { required = true, min = 6, max = 128 } = options || {};
  return [
    ...(required
      ? [
          {
            required: true,
            message: formatMessage({
              id: 'validation.password.required',
              defaultMessage: 'Password is required',
            }),
          },
        ]
      : []),
    {
      min,
      message: formatMessage(
        {
          id: 'validation.password.tooShort',
          defaultMessage: `Password must be at least ${min} characters`,
        },
        { min },
      ),
    },
    {
      max,
      message: formatMessage(
        {
          id: 'validation.password.tooLong',
          defaultMessage: `Password cannot exceed ${max} characters`,
        },
        { max },
      ),
    },
  ];
};

/**
 * Phone number validation rules factory
 * Supports different phone number formats based on area code
 */
export const getPhoneRules = (
  formatMessage: MessageFormatter,
  options?: { required?: boolean; areaCode?: string },
) => {
  const { required = true, areaCode = '86' } = options || {};

  // Different phone number patterns based on area code
  const phonePatterns: Record<string, { pattern: RegExp; example: string }> = {
    '86': { pattern: /^\d{11}$/, example: '11 digits' }, // China mainland: 11 digits
    '87': { pattern: /^\d{8,12}$/, example: '8-12 digits' }, // Other regions: 8-12 digits (flexible)
  };

  const phoneConfig = phonePatterns[areaCode] || phonePatterns['86'];

  return [
    ...(required
      ? [
          {
            required: true,
            message: formatMessage({
              id: 'validation.phone.required',
              defaultMessage: 'Phone number is required',
            }),
          },
        ]
      : []),
    {
      pattern: phoneConfig.pattern,
      message: formatMessage(
        {
          id: 'validation.phone.invalid',
          defaultMessage: `Invalid phone format (expected: ${phoneConfig.example})`,
        },
        { example: phoneConfig.example },
      ),
    },
  ];
};

/**
 * Confirm password validation rule factory
 */
export const getConfirmPasswordRules = (
  formatMessage: MessageFormatter,
  form: FormInstance,
) => {
  return [
    {
      required: true,
      message: formatMessage({
        id: 'validation.confirmPassword.required',
        defaultMessage: 'Please confirm your password',
      }),
    },
    {
      validator: (_: any, value: string) => {
        if (value && value !== form.getFieldValue('password')) {
          return Promise.reject(
            formatMessage({
              id: 'validation.confirmPassword.mismatch',
              defaultMessage: 'The passwords you entered do not match',
            }),
          );
        }
        return Promise.resolve();
      },
    },
  ];
};

/**
 * Predefined validation rule sets (without i18n)
 * Use these when i18n is not needed or for quick prototyping
 */
export const VALIDATION_RULES = {
  email: [
    { required: true, message: 'Email is required' },
    { type: 'email' as const, message: 'Invalid email format' },
    { max: 255, message: 'Email cannot exceed 255 characters' },
  ],
  password: [
    { required: true, message: 'Password is required' },
    { min: 6, message: 'Password must be at least 6 characters' },
    { max: 128, message: 'Password cannot exceed 128 characters' },
  ],
  getPhoneRules: (areaCode: string = '86') => {
    const patterns: Record<string, RegExp> = {
      '86': /^\d{11}$/, // China mainland: 11 digits
      '87': /^\d{8,12}$/, // Other regions: 8-12 digits (flexible)
    };
    return [
      { required: true, message: 'Phone number is required' },
      { pattern: patterns[areaCode] || patterns['86'], message: 'Invalid phone format' },
    ];
  },
} as const;
