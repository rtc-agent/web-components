// 主入口模块
import { eventBus } from './index.js';
import { registry } from './registry.js';
import { escapeHtml, formatDate } from './utils.js';
import type { Task } from './storage.js';

// 暴露到 window 供测试和调试使用
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).registry = registry;

// ============================================
// 连接 <rtc-agent> 组件
// ============================================
customElements.whenDefined('rtc-agent').then(() => {
    const rtcAgentEl = document.querySelector('rtc-agent');
    if (rtcAgentEl) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rtcAgentEl as any).registry = registry;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rtcAgentEl as any).scenariosURL = './scenarios/';
        console.log('[TaskManager] Registry connected to <rtc-agent>');
    }
});

// ============================================
// UI 交互
// ============================================

let currentFilter = 'all';

// 监听 function 执行事件 - 刷新页面并显示 Toast
eventBus.on('function:success', (event) => {
    console.log(`[EventBus] ${event.path} succeeded`);
    // 只对修改数据的操作刷新列表（排除 list/get 查询操作）
    if (['task.create', 'task.update', 'task.delete'].includes(event.path)) {
        renderTasks();
    }
});

eventBus.on('function:error', (event) => {
    console.error(`[EventBus] ${event.path} failed:`, event.error);
});

// 渲染任务列表
export async function renderTasks(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks = await (registry as any).task.list({ filter: currentFilter }) as Task[];
    const container = document.getElementById('taskList')!;

    if (tasks.length === 0) {
        container.innerHTML = '<div class="empty-state">No tasks yet. Create one!</div>';
        return;
    }

    container.innerHTML = tasks.map((task: Task) => `
        <div class="task-item" data-id="${task.id}">
            <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}
                   onchange="toggleTask('${task.id}', this.checked)">
            <div class="task-content" onclick="openEditModal('${task.id}')">
                <div class="task-title ${task.completed ? 'completed' : ''}">${escapeHtml(task.title)}</div>
                <div class="task-meta">
                    <span class="task-priority priority-${task.priority}">${task.priority}</span>
                    ${task.dueDate ? `Due: ${formatDate(task.dueDate)}` : ''}
                </div>
            </div>
            <button class="delete-btn" onclick="deleteTask('${task.id}')">Delete</button>
        </div>
    `).join('');
}

// 暴露到 window
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).renderTasks = renderTasks;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).toggleTask = async function(id: string, completed: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (registry as any).task.update({ id, completed });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).deleteTask = async function(id: string) {
    if (confirm('Are you sure you want to delete this task?')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (registry as any).task.delete({ id });
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).openCreateModal = function() {
    document.getElementById('modalTitle')!.textContent = 'Create Task';
    (document.getElementById('taskForm') as HTMLFormElement).reset();
    (document.getElementById('taskId') as HTMLInputElement).value = '';
    document.getElementById('taskModal')!.classList.add('active');
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).openEditModal = async function(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = await (registry as any).task.get({ id }) as Task;
    document.getElementById('modalTitle')!.textContent = 'Edit Task';
    (document.getElementById('taskId') as HTMLInputElement).value = task.id;
    (document.getElementById('taskTitle') as HTMLInputElement).value = task.title;
    (document.getElementById('taskPriority') as HTMLSelectElement).value = task.priority;
    (document.getElementById('taskDueDate') as HTMLInputElement).value = task.dueDate || '';
    document.getElementById('taskModal')!.classList.add('active');
};

function closeModal() {
    document.getElementById('taskModal')!.classList.remove('active');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).closeModal = closeModal;

// 表单提交
document.getElementById('taskForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (document.getElementById('taskId') as HTMLInputElement).value;
    const title = (document.getElementById('taskTitle') as HTMLInputElement).value;
    const priority = (document.getElementById('taskPriority') as HTMLSelectElement).value as 'low' | 'medium' | 'high';
    const dueDate = (document.getElementById('taskDueDate') as HTMLInputElement).value || undefined;

    if (id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (registry as any).task.update({ id, title, priority, dueDate });
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (registry as any).task.create({ title, priority, dueDate });
    }

    closeModal();
    renderTasks();
});

// 筛选按钮
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = (btn as HTMLElement).dataset.filter!;
        renderTasks();
    });
});

// 初始渲染
renderTasks();
