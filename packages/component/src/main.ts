// Main entry module — TaskManager demo page
import { eventBus } from './index.js';
import { registry } from './registry.js';
import { escapeHtml, formatDate } from './utils.js';
import type { Task } from './storage.js';
import { toolRegistry, virtualFS } from '@rtc-agent/persistence';
import { createLogger } from '@rtc-agent/client';
import type { RtcAgent } from './components/rtc-agent/rtc-agent.js';

const log = createLogger('TaskManager');

// Expose to window for Playwright E2E tests and debug access
declare global {
    interface Window {
        registry: typeof registry;
        toolRegistry: typeof toolRegistry;
        virtualFS: typeof virtualFS;
        renderTasks: () => Promise<void>;
        toggleTask: (id: string, completed: boolean) => Promise<void>;
        deleteTask: (id: string) => Promise<void>;
        openCreateModal: () => void;
        openEditModal: (id: string) => Promise<void>;
        closeModal: () => void;
    }
}

window.registry = registry;
window.toolRegistry = toolRegistry;
window.virtualFS = virtualFS;

// ============================================
// Connect <rtc-agent> component
// ============================================
customElements.whenDefined('rtc-agent').then(() => {
    const rtcAgentEl = document.querySelector('rtc-agent');
    if (rtcAgentEl) {
        // Inject registry — triggers SkillController bridge to toolRegistry
        // (enables script tool to call rtcAgent.task.create() etc.)
        (rtcAgentEl as RtcAgent).registry = registry;
        (rtcAgentEl as RtcAgent).scenariosURL = './scenarios/';
        log.info('Registry connected to <rtc-agent>');
    }
});

// ============================================
// UI interactions
// ============================================

let currentFilter = 'all';

// Refresh task list when data-modifying functions succeed
eventBus.on('function:success', (event) => {
    log.info(`${event.path} succeeded`);
    if (['task.create', 'task.update', 'task.delete'].includes(event.path)) {
        renderTasks();
    }
});

eventBus.on('function:error', (event) => {
    log.error(`${event.path} failed:`, event.error);
});

// Render the task list UI
export async function renderTasks(): Promise<void> {
    const tasks = await registry.execute('task.list', { filter: currentFilter }) as Task[];
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

// Window function assignments (typed via global Window interface augmentation above)
window.renderTasks = renderTasks;

window.toggleTask = async function(id: string, completed: boolean) {
    await registry.execute('task.update', { id, completed });
};

window.deleteTask = async function(id: string) {
    if (confirm('Are you sure you want to delete this task?')) {
        await registry.execute('task.delete', { id });
    }
};

window.openCreateModal = function() {
    document.getElementById('modalTitle')!.textContent = 'Create Task';
    (document.getElementById('taskForm') as HTMLFormElement).reset();
    (document.getElementById('taskId') as HTMLInputElement).value = '';
    document.getElementById('taskModal')!.classList.add('active');
};

window.openEditModal = async function(id: string) {
    const task = await registry.execute('task.get', { id }) as Task;
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
window.closeModal = closeModal;

// Form submit — create or update task
document.getElementById('taskForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (document.getElementById('taskId') as HTMLInputElement).value;
    const title = (document.getElementById('taskTitle') as HTMLInputElement).value;
    const priority = (document.getElementById('taskPriority') as HTMLSelectElement).value as 'low' | 'medium' | 'high';
    const dueDate = (document.getElementById('taskDueDate') as HTMLInputElement).value || undefined;

    if (id) {
        await registry.execute('task.update', { id, title, priority, dueDate });
    } else {
        await registry.execute('task.create', { title, priority, dueDate });
    }

    closeModal();
    renderTasks();
});

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = (btn as HTMLElement).dataset.filter!;
        renderTasks();
    });
});

// Initial render
renderTasks();
