/**
 * Admin API HTTP client
 *
 * Axios-based HTTP client with authentication interceptors for the admin API.
 * Automatically attaches Bearer tokens and handles 401 responses by redirecting to login.
 */
import axios from 'axios';
// ========== HTTP Client ==========
const baseURL = import.meta.env.VITE_ADMIN_API_URL || '';
const httpClient = axios.create({
    baseURL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});
// ========== Request Interceptor ==========
httpClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => Promise.reject(error));
// ========== Response Interceptor ==========
httpClient.interceptors.response.use((response) => response, (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
        // Clear tokens on 401
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        // Redirect to login if not already there
        if (window.location.pathname !== '/login') {
            window.location.href = '/login';
        }
    }
    return Promise.reject(error);
});
// ========== API Methods ==========
/**
 * Admin authentication API.
 */
export const authApi = {
    /**
     * Login with email and password.
     */
    async login(email, password) {
        const response = await httpClient.post('/api/auth/login', {
            email,
            password,
        });
        return response.data;
    },
    /**
     * Get current authenticated user info.
     */
    async getMe() {
        const response = await httpClient.get('/api/auth/me');
        return response.data;
    },
    /**
     * Refresh the access token using a refresh token.
     */
    async refreshToken(refreshToken) {
        const response = await httpClient.post('/api/auth/refresh', {
            refresh_token: refreshToken,
        });
        return response.data;
    },
    /**
     * Logout and revoke the refresh token.
     */
    async logout(refreshToken) {
        await httpClient.post('/api/auth/logout', {
            refresh_token: refreshToken,
        });
    },
};
export default httpClient;
//# sourceMappingURL=api.js.map