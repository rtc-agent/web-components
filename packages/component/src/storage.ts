// 数据存取模块（demo 使用 localStorage，不存入虚拟文件系统）

const STORAGE_KEY = 'rtc-agent-tasks';

export interface Task {
    id: string;
    title: string;
    completed: boolean;
    priority: 'low' | 'medium' | 'high';
    dueDate: string | null;
    createdAt: string;
}

export async function loadTasks(): Promise<Task[]> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}
