// Data storage module (demo uses localStorage, does not write into the virtual file system)

import { safeLocalStorageGetJSON, safeLocalStorageSetJSON } from './utils/safe-local-storage.js';

// Use rtc_ prefix to follow localStorage key naming convention
const STORAGE_KEY = 'rtc_agent_tasks';

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
