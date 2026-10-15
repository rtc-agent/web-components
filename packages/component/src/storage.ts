/**
 * Data storage module (demo uses localStorage, does not write into the virtual file system)
 *
 * Note: This is a demo-only module. For production, use the persistence layer
 * (IndexedDB via SharedWorker) instead of localStorage.
 */

import {
  safeLocalStorageGetJSON,
  safeLocalStorageSetJSON,
} from './utils/safe-local-storage.js';
import { STORAGE_KEYS } from './config/auth.js';

// Use centralized STORAGE_KEYS for consistency
const STORAGE_KEY = STORAGE_KEYS.demoTasks;

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  createdAt: string;
}

export async function loadTasks(): Promise<Task[]> {
  return safeLocalStorageGetJSON<Task[]>(STORAGE_KEY, []);
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  safeLocalStorageSetJSON(STORAGE_KEY, tasks);
}
