import { Spin } from 'antd';

/**
 * Page-level loading component.
 *
 * P3-FIX: Enhanced with centered spinner for better UX.
 * The spinner provides clear visual feedback during page transitions,
 * replacing the previous skeleton-only approach.
 *
 * Future improvements:
 * - Add brand logo or app name above spinner for brand consistency
 * - Consider adding progress bar for long operations
 * - Add accessibility attributes (role="status", aria-live="polite")
 */
const Loading: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: '24px 40px',
    }}
  >
    <Spin size="large" tip="Loading..." />
  </div>
);

export default Loading;
