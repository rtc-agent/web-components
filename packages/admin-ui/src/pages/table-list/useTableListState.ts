import { useCallback, useState } from 'react';

/**
 * Custom hook for managing TableList UI state
 * Extracted to improve separation of concerns and testability
 */
export function useTableListState() {
  const [showDetail, setShowDetail] = useState<boolean>(false);
  const [currentRow, setCurrentRow] = useState<API.RuleListItem | undefined>();
  const [selectedRowsState, setSelectedRows] = useState<API.RuleListItem[]>([]);

  const openDetail = useCallback((row: API.RuleListItem) => {
    setCurrentRow(row);
    setShowDetail(true);
  }, []);

  const closeDetail = useCallback(() => {
    setCurrentRow(undefined);
    setShowDetail(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedRows([]);
  }, []);

  return {
    showDetail,
    currentRow,
    selectedRowsState,
    openDetail,
    closeDetail,
    setSelectedRows,
    clearSelection,
  };
}
