import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' },
});

// Add token to all requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Redirect to login on 401
api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.response?.status === 401 && !err.config.url?.includes('/auth/')) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/';
        }
        return Promise.reject(err);
    }
);

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    role: string;
}

export const authService = {
    register: async (email: string, password: string, name?: string): Promise<{ token: string; user: AuthUser }> => {
        const response = await api.post('/auth/register', { email, password, name });
        const { token, user } = response.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        return { token, user };
    },

    login: async (email: string, password: string): Promise<{ token: string; user: AuthUser }> => {
        const response = await api.post('/auth/login', { email, password });
        const { token, user } = response.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        return { token, user };
    },

    logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
    },

    getUser: (): AuthUser | null => {
        const raw = localStorage.getItem('user');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
    },

    getToken: (): string | null => localStorage.getItem('token'),

    isAuthenticated: (): boolean => !!localStorage.getItem('token'),
};

export { api };
