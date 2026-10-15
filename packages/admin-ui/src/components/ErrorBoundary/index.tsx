import { getIntl } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';

function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /(?:loading|failed to load) (?:css )?chunk/i.test(error.message) ||
    /Failed to fetch dynamically imported module/i.test(error.message)
  );
}

function renderErrorFallback(
  error: Error,
  isOnline: boolean,
  onRetry: () => void,
  onReload: () => void,
) {
  const isOffline = !isOnline;
  const isChunkError = isChunkLoadError(error);

  // Try to use intl, fallback to plain text if Intl provider is not available
  let title = isChunkError ? 'Failed to load page' : 'Something went wrong';
  let subTitle =
    isChunkError && isOffline
      ? 'Your network connection has been lost. Please check your connection and reload.'
      : isChunkError
        ? 'Page resources failed to load. Please reload and try again.'
        : 'Sorry, an error occurred on this page. Please reload or go back to the home page.';

  let retryText = 'Retry';
  let reloadText = 'Reload Page';
  let homeText = 'Back Home';

  try {
    const intl = getIntl();
    title = isChunkError
      ? intl.formatMessage({
          id: 'app.error.chunk.title',
          defaultMessage: 'Failed to load page',
        })
      : intl.formatMessage({
          id: 'app.error.render.title',
          defaultMessage: 'Something went wrong',
        });

    subTitle =
      isChunkError && isOffline
        ? intl.formatMessage({
            id: 'app.error.chunk.description.offline',
            defaultMessage:
              'Your network connection has been lost. Please check your connection and reload.',
          })
        : isChunkError
          ? intl.formatMessage({
              id: 'app.error.chunk.description.online',
              defaultMessage:
                'Page resources failed to load. Please reload and try again.',
            })
          : intl.formatMessage({
              id: 'app.error.render.description',
              defaultMessage:
                'Sorry, an error occurred on this page. Please reload or go back to the home page.',
            });

    retryText = intl.formatMessage({ id: 'app.error.retry' });
    reloadText = intl.formatMessage({ id: 'app.error.reload' });
    homeText = intl.formatMessage({ id: 'app.error.home' });
  } catch (_e) {
    // Intl provider not available, use plain text fallback
  }

  return (
    <Card variant="borderless" style={{ margin: 24 }}>
      <Result
        status="error"
        title={title}
        subTitle={subTitle}
        extra={[
          isChunkError && (
            <Button type="primary" key="retry" onClick={onRetry}>
              {retryText}
            </Button>
          ),
          <Button
            type={isChunkError ? 'default' : 'primary'}
            key="reload"
            onClick={onReload}
          >
            {reloadText}
          </Button>,
          <Button href="/" key="home">
            {homeText}
          </Button>,
        ].filter(Boolean)}
      />
    </Card>
  );
}

/**
 * Global Error Boundary with offline-aware error handling.
 *
 * P3-FIX: Enhanced with better error messaging and recovery options.
 *
 * Future improvements for local ErrorBoundaries:
 * Complex pages (e.g., dashboard with multiple widgets, form-heavy pages)
 * could benefit from local ErrorBoundaries that:
 * 1. Isolate errors to specific sections (prevent full-page crash)
 * 2. Allow per-section retry without reloading the entire page
 * 3. Show inline error messages instead of full-page error UI
 *
 * Implementation pattern for local boundaries:
 * ```tsx
 * <ErrorBoundary fallback={<WidgetErrorWidget />}>
 *   <ComplexWidget />
 * </ErrorBoundary>
 * ```
 *
 * Consider adding local boundaries to:
 * - Dashboard pages (Grafana embeds, stats cards)
 * - Form-heavy pages (multi-section forms)
 * - Data tables with complex renderers
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Optional location pathname for resetting error state on route changes.
   * Pass `location.pathname` from your router to enable route-based reset.
   * If not provided, the ErrorBoundary will only reset on manual retry.
   */
  locationPathname?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isOnline: boolean;
  retryCount: number;
  /** Previous location pathname, used to detect route changes and reset error state */
  _prevPathname?: string;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    retryCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  /**
   * Reset error state when location pathname changes (route navigation).
   *
   * This ensures that:
   * 1. Users get fresh error recovery when navigating to a new route
   * 2. Stale error states don't persist across route changes
   * 3. The ErrorBoundary can recover gracefully after transient errors
   *
   * P2-FIX: Changed from tracking children reference to tracking location pathname.
   * Previously, ANY children change (including state updates in parent components)
   * would reset the error state, potentially masking persistent errors.
   * Now only actual route changes (pathname changes) trigger a reset.
   */
  static getDerivedStateFromProps(
    nextProps: Readonly<ErrorBoundaryProps>,
    prevState: Readonly<ErrorBoundaryState>,
  ): Partial<ErrorBoundaryState> | null {
    // Only reset if pathname is provided AND has changed
    if (
      nextProps.locationPathname &&
      prevState._prevPathname !== nextProps.locationPathname
    ) {
      return {
        hasError: false,
        error: null,
        retryCount: 0,
        _prevPathname: nextProps.locationPathname,
      };
    }
    return null;
  }

  componentDidMount() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  handleOnline = () => {
    this.setState({ isOnline: true });
    if (
      this.state.hasError &&
      this.state.error &&
      isChunkLoadError(this.state.error)
    ) {
      window.location.reload();
    }
  };

  handleOffline = () => {
    this.setState({ isOnline: false });
  };

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log full error details including component stack for debugging
    console.error(
      '[ErrorBoundary] Render error caught:',
      error,
      '\nComponent stack:',
      info.componentStack,
    );

    // Report error to backend for production monitoring.
    // navigator.sendBeacon is fire-and-forget, ideal for error reporting
    // because it doesn't block page unload and works even when the page is closing.
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        const payload = {
          message: error.message,
          stack: error.stack,
          componentStack: info.componentStack,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          timestamp: Date.now(),
        };
        // Use Blob to ensure Content-Type is application/json
        const blob = new Blob([JSON.stringify(payload)], {
          type: 'application/json',
        });
        navigator.sendBeacon('/api/error-report', blob);
      } catch (_reportError) {
        // Error reporting itself failed — log but don't throw
        console.warn('[ErrorBoundary] Failed to report error:', _reportError);
      }
    }
  }

  handleRetry = () => {
    // Incrementing retryCount changes the key on the children fragment,
    // forcing React to unmount and remount all lazy components.
    // This causes React.lazy to re-execute import() for the failed chunk.
    //
    // P2-FIX: Add maximum retry limit (3 attempts) to prevent infinite retry loops.
    // After 3 failed retries, the error is likely persistent (e.g., server issue,
    // corrupted bundle), and further retries would only frustrate the user.
    const MAX_RETRIES = 3;
    if (this.state.retryCount >= MAX_RETRIES) {
      console.error(
        `[ErrorBoundary] Maximum retry attempts (${MAX_RETRIES}) exceeded. ` +
          `Error persists: ${this.state.error?.message}`,
      );
      // Optionally trigger a full page reload as a last resort
      window.location.reload();
      return;
    }

    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError || !this.state.error) {
      return (
        <React.Fragment key={this.state.retryCount}>
          {this.props.children}
        </React.Fragment>
      );
    }
    return renderErrorFallback(
      this.state.error,
      this.state.isOnline,
      this.handleRetry,
      this.handleReload,
    );
  }
}
