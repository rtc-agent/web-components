import { Spin, theme } from 'antd';

/**
 * Page-level loading component.
 *
 * P3-FIX: Enhanced with centered spinner for better UX.
 * The spinner provides clear visual feedback during page transitions,
 * replacing the previous skeleton-only approach.
 * Includes accessibility attributes (role="status", aria-live="polite")
 * for screen reader support.
 *
 * Uses theme tokens for background color to support both light and dark modes.
 *
 * Future improvements:
 * - Add brand logo or app name above spinner for brand consistency
 * - Consider adding progress bar for long operations
 */
const Loading: React.FC = () => {
  const { token } = theme.useToken();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '24px 40px',
        backgroundColor: token.colorBgLayout,
        color: token.colorTextSecondary,
      }}
    >
      <Spin size="large" tip="Loading..." />
    </div>
  );
};

export default Loading;
