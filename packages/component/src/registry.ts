// Registry 定义和 Function 注册
import { defineRegistry } from './index.js';
import { loadTasks, saveTasks, type Task } from './storage.js';
import { generateUUID, showToast } from './utils.js';

export const registry = defineRegistry({
    name: 'TaskManager',
    description: 'A simple task management application',
    persona: 'You are a helpful task management assistant.'
});

// 创建 Task Group
const taskGroup = registry.createGroup({
    name: 'task',
    description: 'Task management operations'
});

// task.list - 获取任务列表
taskGroup.register({
    name: 'list',
    description: 'List all tasks with optional filtering',
    parameters: [
        {
            name: 'filter',
            schema: {
                type: 'string',
                enum: ['all', 'active', 'completed'],
                default: 'all',
                description: 'Filter tasks by status'
            },
            required: false
        }
    ],
    returns: {
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    title: { type: 'string' },
                    completed: { type: 'boolean' },
                    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                    dueDate: { type: 'string', format: 'date-time' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            description: 'Array of tasks'
        }
    },
    hooks: {
        onStart: (params) => {
            console.log('[task.list] Fetching tasks with filter:', params.filter);
        },
        onSuccess: (result) => {
            console.log('[task.list] Success:', (result as Task[]).length, 'tasks');
        }
    },
    handler: async (params) => {
        const allTasks = await loadTasks();
        const filter = (params.filter as string) || 'all';

        if (filter === 'active') {
            return allTasks.filter(t => !t.completed);
        } else if (filter === 'completed') {
            return allTasks.filter(t => t.completed);
        }
        return allTasks;
    }
});

// task.get - 获取单个任务
taskGroup.register({
    name: 'get',
    description: 'Get a specific task by ID',
    parameters: [
        {
            name: 'id',
            schema: {
                type: 'string',
                format: 'uuid',
                description: 'Task ID'
            },
            required: true
        }
    ],
    returns: {
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                completed: { type: 'boolean' },
                priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                dueDate: { type: 'string', format: 'date-time' },
                createdAt: { type: 'string', format: 'date-time' }
            },
            description: 'Task object'
        }
    },
    handler: async (params) => {
        const tasks = await loadTasks();
        const task = tasks.find(t => t.id === params.id);
        if (!task) {
            throw new Error(`Task not found: ${params.id}`);
        }
        return task;
    }
});

// task.create - 创建任务
taskGroup.register({
    name: 'create',
    description: 'Create a new task',
    parameters: [
        {
            name: 'title',
            schema: { type: 'string', description: 'Task title' },
            required: true
        },
        {
            name: 'priority',
            schema: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                default: 'medium',
                description: 'Task priority'
            },
            required: false
        },
        {
            name: 'dueDate',
            schema: { type: 'string', format: 'date-time', description: 'Due date' },
            required: false
        }
    ],
    returns: {
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                completed: { type: 'boolean' },
                priority: { type: 'string' },
                dueDate: { type: 'string', format: 'date-time' },
                createdAt: { type: 'string', format: 'date-time' }
            },
            description: 'Created task'
        }
    },
    hooks: {
        onSuccess: () => {
            console.log('[registry] task.create onSuccess hook triggered');
            showToast('Task created successfully', 'success');
        }
    },
    handler: async (params) => {
        const tasks = await loadTasks();
        const newTask: Task = {
            id: generateUUID(),
            title: params.title as string,
            completed: false,
            priority: (params.priority as 'low' | 'medium' | 'high') || 'medium',
            dueDate: (params.dueDate as string) || null,
            createdAt: new Date().toISOString()
        };
        tasks.push(newTask);
        await saveTasks(tasks);
        return newTask;
    }
});

// task.update - 更新任务
taskGroup.register({
    name: 'update',
    description: 'Update an existing task',
    parameters: [
        {
            name: 'id',
            schema: { type: 'string', format: 'uuid', description: 'Task ID' },
            required: true
        },
        {
            name: 'title',
            schema: { type: 'string', description: 'Task title' },
            required: false
        },
        {
            name: 'completed',
            schema: { type: 'boolean', description: 'Task completion status' },
            required: false
        },
        {
            name: 'priority',
            schema: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Task priority'
            },
            required: false
        },
        {
            name: 'dueDate',
            schema: { type: 'string', format: 'date-time', description: 'Due date' },
            required: false
        }
    ],
    returns: {
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                completed: { type: 'boolean' },
                priority: { type: 'string' },
                dueDate: { type: 'string', format: 'date-time' },
                createdAt: { type: 'string', format: 'date-time' }
            },
            description: 'Updated task'
        }
    },
    hooks: {
        onSuccess: () => {
            showToast('Task updated successfully', 'success');
        }
    },
    handler: async (params) => {
        const tasks = await loadTasks();
        const index = tasks.findIndex(t => t.id === params.id);
        if (index === -1) {
            throw new Error(`Task not found: ${params.id}`);
        }

        const task = tasks[index];
        if (params.title !== undefined) task.title = params.title as string;
        if (params.completed !== undefined) task.completed = params.completed as boolean;
        if (params.priority !== undefined) task.priority = params.priority as 'low' | 'medium' | 'high';
        if (params.dueDate !== undefined) task.dueDate = (params.dueDate as string) || null;

        tasks[index] = task;
        await saveTasks(tasks);
        return task;
    }
});

// task.delete - 删除任务
taskGroup.register({
    name: 'delete',
    description: 'Delete a task',
    parameters: [
        {
            name: 'id',
            schema: { type: 'string', format: 'uuid', description: 'Task ID' },
            required: true
        }
    ],
    returns: {
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' }
            },
            description: 'Deletion result'
        }
    },
    hooks: {
        onSuccess: () => {
            showToast('Task deleted', 'success');
        },
        onError: (error) => {
            showToast(`Failed to delete task: ${error.message}`, 'error');
        }
    },
    handler: async (params) => {
        const tasks = await loadTasks();
        const filtered = tasks.filter(t => t.id !== params.id);
        if (filtered.length === tasks.length) {
            throw new Error(`Task not found: ${params.id}`);
        }
        await saveTasks(filtered);
        return { success: true, message: 'Task deleted' };
    }
});
