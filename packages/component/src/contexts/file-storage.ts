/**
 * FileStorage Context
 *
 * Provides FileStorage instance to component tree via Lit Context.
 * Components consume this context to access file upload/download APIs.
 *
 * Provided by rtc-agent root component using ContextProvider.
 * Consumed by file-related components (rtc-input-area, rtc-file-preview-modal).
 *
 * @module contexts/file-storage
 */
import {createContext} from '@lit/context';
import type {FileStorage} from '../utils/file-storage.js';

/**
 * FileStorage context value shape.
 * Simple wrapper for FileStorage instance.
 * fileStorage is null until WorkerBridge is initialized.
 */
export interface FileStorageContextValue {
  fileStorage: FileStorage | null;
}

/**
 * Lit Context for FileStorage dependency injection.
 * Provided by rtc-agent, consumed by file-related components.
 */
export const FileStorageContext = createContext<FileStorageContextValue>(
  Symbol('file-storage-context')
);
