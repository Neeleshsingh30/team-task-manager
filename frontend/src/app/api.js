import { setAuthenticatedUser, setCurrentUser, setWorkspaces } from "../features/workspaceSlice";

// Vite replaces VITE_API_URL at build time. Keep local development convenient,
// while ensuring a deployed frontend never tries to call the visitor's localhost.
const DEFAULT_API_BASE_URL = typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? "https://team-task-manager-backend-abm7.onrender.com/api"
    : "http://127.0.0.1:8000/api";
export const API_BASE_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");
let bootstrapPromise = Promise.resolve();
const TOKEN_KEY = "ttm_access_token";

export const getAccessToken = () => window.localStorage.getItem(TOKEN_KEY);
export const setAccessToken = (token) => window.localStorage.setItem(TOKEN_KEY, token);
export const clearAccessToken = () => window.localStorage.removeItem(TOKEN_KEY);

export async function apiRequest(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            signal: controller.signal,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
                ...options.headers,
            },
        });
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("The API request timed out after 60 seconds. The backend or database may be unavailable; retry when the service is running.");
        }
        throw new Error(`Could not reach the API at ${API_BASE_URL}. Check the backend service and its CORS settings.`);
    } finally {
        window.clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortFromCaller);
    }

    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401 && getAccessToken() && !path.startsWith("/auth/")) {
            window.dispatchEvent(new CustomEvent("app:auth-required"));
        }
        const detail = typeof payload?.detail === "string" ? payload.detail : `Request failed (${response.status})`;
        throw new Error(detail);
    }
    return payload;
}

export const getWorkspaces = () => apiRequest("/workspaces");
export const createWorkspaceRemote = (workspace) => apiRequest("/workspaces", { method: "POST", body: JSON.stringify(workspace) });
export const login = (email, password) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const register = (name, email, password) => apiRequest("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
export const getCurrentUser = () => apiRequest("/auth/me");
export const updateProfile = (profile) => apiRequest("/auth/profile", {
    method: "PUT", body: JSON.stringify(profile),
});
export const changePassword = (currentPassword, newPassword) => apiRequest("/auth/change-password", {
    method: "POST", body: JSON.stringify({ currentPassword, newPassword }),
});
export const getNotifications = () => apiRequest("/auth/notifications");
export const markNotificationRead = (notificationId) => apiRequest(`/auth/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" });
export const markAllNotificationsRead = () => apiRequest("/auth/notifications/read-all", { method: "POST" });
export const createInvitation = (workspaceId, email, role) => apiRequest(`/auth/workspaces/${encodeURIComponent(workspaceId)}/invitations`, {
    method: "POST", body: JSON.stringify({ email, role }),
});
export const acceptInvitation = (data) => apiRequest("/auth/invitations/accept", { method: "POST", body: JSON.stringify(data) });

export const migrateLocalWorkspaces = (workspaces, currentUserId) => apiRequest("/migrate-local", {
    method: "POST",
    body: JSON.stringify({ workspaces, currentUserId }),
});

export const saveWorkspace = (workspace) => apiRequest(`/workspaces/${encodeURIComponent(workspace.id)}/sync`, {
    method: "PUT",
    body: JSON.stringify(workspace),
});
export const updateTaskRemote = (task) => apiRequest(`/tasks/${encodeURIComponent(task.id)}`, {
    method: "PUT", body: JSON.stringify(task),
});
export const createTaskRemote = (projectId, task) => apiRequest(`/projects/${encodeURIComponent(projectId)}/tasks`, {
    method: "POST", body: JSON.stringify(task),
});
export const deleteTaskRemote = (taskId) => apiRequest(`/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });

export const removeWorkspace = (workspaceId) => apiRequest(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
});

export const getTaskComments = (taskId) => apiRequest(`/tasks/${encodeURIComponent(taskId)}/comments`);

export const postTaskComment = (taskId, comment) => apiRequest(`/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    body: JSON.stringify(comment),
});

export function initializeBackend(dispatch) {
    bootstrapPromise = (async () => {
        try {
            const user = await getCurrentUser();
            dispatch(setCurrentUser(user.id));
            dispatch(setAuthenticatedUser(user));
            const remoteWorkspaces = await getWorkspaces();
            if (remoteWorkspaces.length) {
                dispatch(setWorkspaces(remoteWorkspaces));
            } else {
                dispatch(setWorkspaces([]));
            }
            if (typeof window !== "undefined") window.localStorage.removeItem("workspaces");
            return user;
        } catch (error) {
            clearAccessToken();
            window.dispatchEvent(new CustomEvent("app:auth-required"));
            reportApiError(error);
            throw error;
        }
    })();
    return bootstrapPromise;
}

export const waitForBackendInitialization = () => bootstrapPromise;

export function reportApiError(error) {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("app:api-error", { detail: error?.message || "Database save failed" }));
    }
}
