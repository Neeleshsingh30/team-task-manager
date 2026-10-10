import { configureStore } from '@reduxjs/toolkit'
import workspaceReducer from '../features/workspaceSlice'
import themeReducer from '../features/themeSlice'
import { createWorkspaceRemote, deleteTaskRemote, removeWorkspace, reportApiError, saveWorkspace, updateTaskRemote, waitForBackendInitialization } from './api'

const pendingWorkspaceWrites = new Map()

const databaseSyncMiddleware = (storeApi) => (next) => (action) => {
    const before = storeApi.getState().workspace
    const result = next(action)
    const type = action?.type
    const workspaceState = storeApi.getState().workspace

    if (type === 'workspace/addWorkspace') {
        const workspace = action.payload
        const write = waitForBackendInitialization().then(() => createWorkspaceRemote(workspace))
        write.catch(reportApiError)
        return result
    }

    if (type === 'workspace/updateTask') {
        const task = action.payload
        const workspaceId = workspaceState.currentWorkspace?.id
        if (task?.id && workspaceId) {
            const previous = pendingWorkspaceWrites.get(workspaceId) || Promise.resolve()
            const write = previous.catch(() => {}).then(waitForBackendInitialization).then(() => updateTaskRemote(task))
            pendingWorkspaceWrites.set(workspaceId, write)
            write.catch(reportApiError).finally(() => {
                if (pendingWorkspaceWrites.get(workspaceId) === write) pendingWorkspaceWrites.delete(workspaceId)
            })
        }
        return result
    }

    if (type === 'workspace/deleteTask') {
        const selectedIds = Array.isArray(action.payload) ? action.payload : [action.payload?.id].filter(Boolean)
        const workspaceId = before.currentWorkspace?.id
        if (workspaceId) {
            const previous = pendingWorkspaceWrites.get(workspaceId) || Promise.resolve()
            const write = previous.catch(() => {}).then(waitForBackendInitialization).then(async () => {
                for (const taskId of selectedIds) await deleteTaskRemote(taskId)
            })
            pendingWorkspaceWrites.set(workspaceId, write)
            write.catch(reportApiError).finally(() => {
                if (pendingWorkspaceWrites.get(workspaceId) === write) pendingWorkspaceWrites.delete(workspaceId)
            })
        }
        return result
    }

    if (type === 'workspace/deleteWorkspace') {
        const workspaceId = action.payload
        const previous = pendingWorkspaceWrites.get(workspaceId) || Promise.resolve()
        const write = previous.catch(() => {}).then(waitForBackendInitialization).then(() => removeWorkspace(workspaceId))
        pendingWorkspaceWrites.set(workspaceId, write)
        write.catch(reportApiError).finally(() => {
            if (pendingWorkspaceWrites.get(workspaceId) === write) pendingWorkspaceWrites.delete(workspaceId)
        })
        return result
    }

    const shouldSync = [
        'workspace/addWorkspace',
        'workspace/updateWorkspace',
    ].includes(type)
    if (!shouldSync) return result

    const workspaceId = type === 'workspace/updateWorkspace'
        ? action.payload?.id
        : type === 'workspace/addWorkspace'
            ? action.payload?.id
            : workspaceState.currentWorkspace?.id
    const workspace = workspaceState.workspaces.find((item) => item.id === workspaceId)
        || (workspaceState.currentWorkspace?.id === workspaceId ? workspaceState.currentWorkspace : null)
    if (!workspace || !workspaceId) return result

    const snapshot = structuredClone(workspace)
    const previous = pendingWorkspaceWrites.get(workspaceId) || Promise.resolve()
    const write = previous.catch(() => {})
        .then(waitForBackendInitialization)
        .then(() => saveWorkspace(snapshot))
    pendingWorkspaceWrites.set(workspaceId, write)
    write.catch(reportApiError).finally(() => {
        if (pendingWorkspaceWrites.get(workspaceId) === write) pendingWorkspaceWrites.delete(workspaceId)
    })
    return result
}

export const store = configureStore({
    reducer: {
        workspace: workspaceReducer,
        theme: themeReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(databaseSyncMiddleware),
})

if (typeof window !== "undefined") {
    store.subscribe(() => {
        try {
            const { currentWorkspace } = store.getState().workspace;
            if (currentWorkspace?.id) {
                window.localStorage.setItem("currentWorkspaceId", currentWorkspace.id);
            }
            if (store.getState().workspace.currentUserId) {
                window.localStorage.setItem("currentUserId", store.getState().workspace.currentUserId);
            }
        } catch {
            // Keep the app usable when browser storage is unavailable.
        }
    });
}
