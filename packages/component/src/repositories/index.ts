/**
 * Repositories
 *
 * Data management layer with per-entity state isolation and pub-sub notifications.
 */

export {MessageRepository, MESSAGE_PAGE_SIZE} from './message.repository.js';
export type {MessageApi, SessionDataCallback} from './message.repository.js';
