// Main entry module — TaskManager demo page
import { eventBus } from './index.js';
import { registry } from './registry.js';
import { escapeHtml, formatDate } from './utils.js';
import type { Task } from './storage.js';
// ARCHITECTURE NOTE: Direct persistence import for debug/exposure purposes
// These are exposed on `window` for E2E tests and debugging access.
// In production code, prefer using the registry or WorkerBridge APIs.
import { toolRegistry, virtualFS } from '@rtc-agent/persistence';
import { createLogger } from '@rtc-agent/protocol';
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
  const tasks = (await registry.execute('task.list', {
    filter: currentFilter,
  })) as Task[];
  const container = document.getElementById('taskList');

  if (!container) {
    log.warn('Task list container not found');
    return;
  }

  if (tasks.length === 0) {
    // SECURITY: 静态 HTML 字符串，无用户输入，安全
    container.innerHTML =
      '<div class="empty-state">No tasks yet. Create one!</div>';
    return;
  }

  // SECURITY: 使用 escapeHtml() 对所有用户输入进行 XSS 防护后再插入 innerHTML
  // escapeHtml() 会转义 &, <, >, ", ', `, / 等危险字符，防止 XSS 攻击
  // 详见 utils.ts 中的 escapeHtml() 实现
  container.innerHTML = tasks
    .map(
      (task: Task) => `
        <div class="task-item" data-id="${escapeHtml(task.id)}">
            <input type="checkbox" class="task-checkbox" data-task-id="${escapeHtml(task.id)}" ${task.completed ? 'checked' : ''}>
            <div class="task-content" data-task-id="${escapeHtml(task.id)}" data-action="edit">
                <div class="task-title ${task.completed ? 'completed' : ''}">${escapeHtml(task.title)}</div>
                <div class="task-meta">
                    <span class="task-priority priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>
                    ${task.dueDate ? `Due: ${escapeHtml(formatDate(task.dueDate))}` : ''}
                </div>
            </div>
            <button class="delete-btn" data-task-id="${escapeHtml(task.id)}" data-action="delete">Delete</button>
        </div>
    `,
    )
    .join('');
}

// Event delegation to avoid inline handlers and prevent XSS
document.addEventListener('change', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('task-checkbox')) {
    const id = (target as HTMLInputElement).dataset.taskId;
    if (id) window.toggleTask(id, (target as HTMLInputElement).checked);
  }
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const actionEl = target.closest('[data-action]') as HTMLElement | null;
  if (!actionEl) return;
  const id = actionEl.dataset.taskId;
  if (!id) return;
  if (actionEl.dataset.action === 'edit') window.openEditModal(id);
  if (actionEl.dataset.action === 'delete') window.deleteTask(id);
});

// Window function assignments (typed via global Window interface augmentation above)
window.renderTasks = renderTasks;

window.toggleTask = async function (id: string, completed: boolean) {
  await registry.execute('task.update', { id, completed });
};

window.deleteTask = async function (id: string) {
  if (confirm('Are you sure you want to delete this task?')) {
    await registry.execute('task.delete', { id });
  }
};

window.openCreateModal = function () {
  const modalTitle = document.getElementById('modalTitle');
  const taskForm = document.getElementById('taskForm') as HTMLFormElement | null;
  const taskId = document.getElementById('taskId') as HTMLInputElement | null;
  const taskModal = document.getElementById('taskModal');

  if (!modalTitle || !taskForm || !taskId || !taskModal) {
    log.warn('Required modal elements not found');
    return;
  }

  modalTitle.textContent = 'Create Task';
  taskForm.reset();
  taskId.value = '';
  taskModal.classList.add('active');
};

window.openEditModal = async function (id: string) {
  const task = (await registry.execute('task.get', { id })) as Task;
  const modalTitle = document.getElementById('modalTitle');
  const taskId = document.getElementById('taskId') as HTMLInputElement | null;
  const taskTitle = document.getElementById('taskTitle') as HTMLInputElement | null;
  const taskPriority = document.getElementById('taskPriority') as HTMLSelectElement | null;
  const taskDueDate = document.getElementById('taskDueDate') as HTMLInputElement | null;
  const taskModal = document.getElementById('taskModal');

  if (!modalTitle || !taskId || !taskTitle || !taskPriority || !taskDueDate || !taskModal) {
    log.warn('Required modal elements not found');
    return;
  }

  modalTitle.textContent = 'Edit Task';
  taskId.value = task.id;
  taskTitle.value = task.title;
  taskPriority.value = task.priority;
  taskDueDate.value = task.dueDate || '';
  taskModal.classList.add('active');
};

function closeModal() {
  const taskModal = document.getElementById('taskModal');
  if (!taskModal) {
    log.warn('Task modal not found');
    return;
  }
  taskModal.classList.remove('active');
}
window.closeModal = closeModal;

// Form submit — create or update task
const taskForm = document.getElementById('taskForm');
if (taskForm) {
  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (document.getElementById('taskId') as HTMLInputElement).value;
    const title = (document.getElementById('taskTitle') as HTMLInputElement).value;
    const priority = (document.getElementById('taskPriority') as HTMLSelectElement).value as
      | 'low'
      | 'medium'
      | 'high';
    const dueDate =
      (document.getElementById('taskDueDate') as HTMLInputElement).value || undefined;

    if (id) {
      await registry.execute('task.update', { id, title, priority, dueDate });
    } else {
      await registry.execute('task.create', { title, priority, dueDate });
    }

    closeModal();
    renderTasks();
  });
} else {
  log.warn('Task form not found');
}

// Filter buttons
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document
      .querySelectorAll('.filter-btn')
      .forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = (btn as HTMLElement).dataset.filter!;
    renderTasks();
  });
});

// Initial render
renderTasks();
