/**
 * Service layer for the login page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import from this file rather than @/services/ directly.
 */

export type { LoginResult } from '@/services/admin-auth';
export {
	getLoginConfig,
	login,
	loginWithOTP,
	sendEmailOTP,
} from '@/services/admin-auth';
