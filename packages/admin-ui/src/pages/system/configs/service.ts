/**
 * Service layer for the system configs page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import from this file rather than @/services/ directly.
 */

export type { ServerConfigItem } from '@/services/server-config';
export {
	deleteServerConfig,
	getServerConfigList,
	updateServerConfig,
} from '@/services/server-config';
