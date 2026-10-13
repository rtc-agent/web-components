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
 * Phone number validation rules factory (China mainland format)
 */
export const getPhoneRules = (
  formatMessage: MessageFormatter,
  options?: { required?: boolean },
) => {
  const { required = true } = options || {};
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
      pattern: /^\d{11}$/,
      message: formatMessage({
        id: 'validation.phone.invalid',
        defaultMessage: 'Invalid phone format',
      }),
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
  phone: [
    { required: true, message: 'Phone number is required' },
    { pattern: /^\d{11}$/, message: 'Invalid phone format' },
  ],
} as const;
