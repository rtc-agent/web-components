/**
 * Repositories
 *
 * Data management layer with per-entity state isolation and pub-sub notifications.
 */

export type { MessageApi, SessionDataCallback } from './message.repository.js';
export { MESSAGE_PAGE_SIZE, MessageRepository } from './message.repository.js';
