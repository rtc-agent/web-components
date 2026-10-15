import { useCallback, useState } from 'react';

/**
 * Modal state managed by {@link useModalState}.
 *
 * @template T - Type of the record associated with the modal (e.g., table row).
 *               Use `void` when the modal has no associated record.
 */
export interface ModalState<T = void> {
  /** Whether the modal is visible */
  open: boolean;
  /** The record currently being operated on, or undefined if none */
  record: T | undefined;
}

/**
 * Actions returned by {@link useModalState} to control modal visibility and record.
 *
 * @template T - Type of the record associated with the modal.
 */
export interface ModalActions<T = void> {
  /** Current modal state (open flag + record) */
  state: ModalState<T>;
  /** Open the modal, optionally associating a record */
  open: (record?: T) => void;
  /** Close the modal and clear the record */
  close: () => void;
  /** Replace the currently associated record without changing visibility */
  setRecord: (record: T | undefined) => void;
}

/**
 * Unified hook for managing Modal/Drawer open + selected-record state.
 *
 * Many pages need the same three pieces of state:
 * 1. Is the modal open? (boolean)
 * 2. Which record is being edited/viewed? (T | undefined)
 * 3. Handlers to open/close/update.
 *
 * This hook consolidates that pattern into a single, well-typed hook,
 * eliminating the need for multiple `useState` calls per modal.
 *
 * @example
 * ```tsx
 * // Simple modal (no record)
 * const { state, open, close } = useModalState();
 * <Modal open={state.open} onCancel={close} />
 * <Button onClick={() => open()}>Create</Button>
 *
 * // Edit modal with record
 * const { state, open, close } = useModalState<UserInfo>();
 * <Modal open={state.open} onCancel={close}>
 *   <EditForm record={state.record} />
 * </Modal>
 * <Button onClick={() => open(user)}>Edit</Button>
 * ```
 *
 * @template T - Type of the record associated with the modal.
 */
export function useModalState<T = void>(): ModalActions<T> {
  const [state, setState] = useState<ModalState<T>>({
    open: false,
    record: undefined,
  });

  const open = useCallback((record?: T) => {
    setState({ open: true, record });
  }, []);

  const close = useCallback(() => {
    setState({ open: false, record: undefined });
  }, []);

  const setRecord = useCallback((record: T | undefined) => {
    setState((prev) => {
      // P2 修复：浅比较避免不必要的状态更新
      // 如果 record 没有变化（引用相同或都是 undefined），不触发重渲染
      if (prev.record === record) {
        return prev;
      }
      return { ...prev, record };
    });
  }, []);

  return { state, open, close, setRecord };
}
