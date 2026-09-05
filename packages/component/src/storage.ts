// 数据存取模块
import { virtualFS } from '@rtc-agent/persistence';

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
        const data = await virtualFS.read('/tasks.json');
        return JSON.parse(data || '[]');
    } catch {
        return [];
    }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
    await virtualFS.write('/tasks.json', JSON.stringify(tasks, null, 2));
}
