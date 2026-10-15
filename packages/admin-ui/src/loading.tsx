import { useIntl } from '@umijs/max';
import { Spin } from 'antd';
import { createStyles } from 'antd-style';

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

const useStyles = createStyles(({ token }) => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: '24px 40px',
    backgroundColor: token.colorBgLayout,
    color: token.colorTextSecondary,
  },
}));

const Loading: React.FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  return (
    <div role="status" aria-live="polite" className={styles.container}>
      <Spin
        size="large"
        tip={intl.formatMessage({
          id: 'app.loading',
          defaultMessage: 'Loading...',
        })}
      />
    </div>
  );
};

export default Loading;
