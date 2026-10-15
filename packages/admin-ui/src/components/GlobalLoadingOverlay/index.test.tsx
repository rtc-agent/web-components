/**
 * GlobalLoadingOverlay Accessibility Tests
 *
 * Tests the accessibility features of the global loading overlay component,
 * including ARIA attributes and screen reader support.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GlobalLoadingOverlay from './index';

describe('GlobalLoadingOverlay - Accessibility', () => {
  describe('ARIA attributes', () => {
    it('should have role="status" for screen reader announcement', () => {
      render(<GlobalLoadingOverlay />);

      const overlay = screen.getByRole('status');
      expect(overlay).toBeInTheDocument();
    });

    it('should have aria-live="polite" for non-intrusive updates', () => {
      render(<GlobalLoadingOverlay />);

      const overlay = screen.getByRole('status');
      expect(overlay).toHaveAttribute('aria-live', 'polite');
    });

    it('should have aria-label describing the loading state', () => {
      render(<GlobalLoadingOverlay />);

      const overlay = screen.getByRole('status');
      expect(overlay).toHaveAttribute('aria-label', 'Application loading');
    });
  });

  describe('Custom message', () => {
    it('should display default message when no message prop provided', () => {
      render(<GlobalLoadingOverlay />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('should display custom message when provided', () => {
      const customMessage = 'Initializing application...';
      render(<GlobalLoadingOverlay message={customMessage} />);

      expect(screen.getByText(customMessage)).toBeInTheDocument();
    });

    it('should update message when prop changes', () => {
      const { rerender } = render(<GlobalLoadingOverlay message="Loading..." />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();

      rerender(<GlobalLoadingOverlay message="Almost done..." />);

      expect(screen.getByText('Almost done...')).toBeInTheDocument();
    });
  });

  describe('Screen reader support', () => {
    it('should be accessible to screen readers with proper semantic markup', () => {
      render(<GlobalLoadingOverlay />);

      // Verify the component has the correct ARIA role
      const statusRegion = screen.getByRole('status');
      expect(statusRegion).toBeInTheDocument();

      // Verify the message is readable
      const message = screen.getByText('Loading...');
      expect(message).toBeInTheDocument();
      expect(message.tagName.toLowerCase()).toBe('div');
    });

    it('should announce loading state changes to screen readers', () => {
      const { rerender } = render(<GlobalLoadingOverlay message="Step 1 of 3" />);

      let statusRegion = screen.getByRole('status');
      expect(statusRegion).toHaveTextContent('Step 1 of 3');

      rerender(<GlobalLoadingOverlay message="Step 2 of 3" />);

      statusRegion = screen.getByRole('status');
      expect(statusRegion).toHaveTextContent('Step 2 of 3');
    });
  });

  describe('Visual presentation', () => {
    it('should render spinner for visual feedback', () => {
      render(<GlobalLoadingOverlay />);

      // Ant Design Spin component renders with specific class
      const spinner = document.querySelector('.ant-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should render spinner with large size', () => {
      render(<GlobalLoadingOverlay />);

      // Large spin has specific class
      const largeSpinner = document.querySelector('.ant-spin-lg');
      expect(largeSpinner).toBeInTheDocument();
    });
  });
});
