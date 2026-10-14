import { InboxOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Empty, theme } from 'antd';
import type { ReactNode } from 'react';
import React from 'react';

/**
 * Props for TableEmptyState component
 */
export interface TableEmptyStateProps {
  /** Custom description text. If not provided, uses default i18n message */
  description?: string;
  /** i18n message ID for description */
  descriptionId?: string;
  /** Default message for i18n */
  defaultDescription?: string;
  /** Icon size in pixels */
  iconSize?: number;
  /** Optional action element (e.g., button) to display below description */
  action?: ReactNode;
}

/**
 * Unified empty state component for ProTable.
 * Ensures consistent styling and behavior across all tables.
 *
 * Accessibility:
 * - Uses role="status" and aria-live="polite" to announce empty state to screen readers
 * - Icon has aria-hidden="true" as it is purely decorative
 * - Description is the primary accessible label
 */
const TableEmptyState: React.FC<TableEmptyStateProps> = ({
  description,
  descriptionId,
  defaultDescription = 'No data found',
  iconSize = 48,
  action,
}) => {
  const intl = useIntl();
  const { token } = theme.useToken();

  const displayDescription =
    description ||
    intl.formatMessage({
      id: descriptionId || 'components.tableEmptyState.noData',
      defaultMessage: defaultDescription,
    });

  return (
    <div role="status" aria-live="polite">
      <Empty
        image={
          <InboxOutlined
            aria-hidden="true"
            style={{ fontSize: iconSize, color: token.colorTextTertiary }}
          />
        }
        description={displayDescription}
      >
        {action}
      </Empty>
    </div>
  );
};

export default TableEmptyState;
