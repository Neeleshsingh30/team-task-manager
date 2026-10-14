import { createSlice } from "@reduxjs/toolkit";

if (typeof window !== "undefined") {
    try {
        window.localStorage.removeItem("workspaces");
    } catch {
        // The app reads workspace data from the backend, not browser storage.
    }
}
const readSavedWorkspaceId = () => {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem("currentWorkspaceId");
    } catch {
        return null;
    }
};
const savedWorkspaceId = readSavedWorkspaceId();
const initialState = {
    workspaces: [],
    currentWorkspace: null,
    currentUserId: null,
    authenticatedUser: null,
    loading: false,
};

const workspaceSlice = createSlice({
    name: "workspace",
    initialState,
    reducers: {
        setWorkspaces: (state, action) => {
            state.workspaces = action.payload;
            const selectedId = state.currentWorkspace?.id || (typeof window !== "undefined" ? window.localStorage.getItem("currentWorkspaceId") : null);
            state.currentWorkspace = action.payload.find((workspace) => workspace.id === selectedId) || action.payload[0] || null;
        },
        setCurrentWorkspace: (state, action) => {
            try {
                if (typeof window !== "undefined") window.localStorage.setItem("currentWorkspaceId", action.payload);
            } catch {
                // The selected workspace still updates in memory if storage is unavailable.
            }
            state.currentWorkspace = state.workspaces.find((w) => w.id === action.payload);
        },
        setCurrentUser: (state, action) => {
            state.currentUserId = action.payload;
            try {
                if (typeof window !== "undefined") window.localStorage.setItem("currentUserId", action.payload);
            } catch {
                // The selection still updates in memory if storage is unavailable.
            }
        },
        setAuthenticatedUser: (state, action) => {
            state.authenticatedUser = action.payload;
            state.currentUserId = action.payload?.id || null;
        },
        addWorkspace: (state, action) => {
            state.workspaces.push(action.payload);

            // set current workspace to the new workspace
            if (state.currentWorkspace?.id !== action.payload.id) {
                state.currentWorkspace = action.payload;
            }
        },
        updateWorkspace: (state, action) => {
            state.workspaces = state.workspaces.map((w) =>
                w.id === action.payload.id ? action.payload : w
            );

            // if current workspace is updated, set it to the updated workspace
            if (state.currentWorkspace?.id === action.payload.id) {
                state.currentWorkspace = action.payload;
            }
        },
        deleteWorkspace: (state, action) => {
            const wasCurrent = state.currentWorkspace?.id === action.payload;
            state.workspaces = state.workspaces.filter((workspace) => workspace.id !== action.payload);
            if (wasCurrent) {
                state.currentWorkspace = state.workspaces[0] || null;
                try {
                    if (typeof window !== "undefined") {
                        if (state.currentWorkspace) window.localStorage.setItem("currentWorkspaceId", state.currentWorkspace.id);
                        else window.localStorage.removeItem("currentWorkspaceId");
                    }
                } catch {
                    // The active workspace still changes in memory if storage is unavailable.
                }
            }
        },
        addProject: (state, action) => {
            state.currentWorkspace.projects.push(action.payload);
            // find workspace by id and add project to it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? { ...w, projects: w.projects.concat(action.payload) } : w
            );
        },
        addTask: (state, action) => {

            state.currentWorkspace.projects = state.currentWorkspace.projects.map((p) => {
                console.log(p.id, action.payload.projectId, p.id === action.payload.projectId);
                if (p.id === action.payload.projectId) {
                    p.tasks.push(action.payload);
                }
                return p;
            });

            // find workspace and project by id and add task to it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? {
                    ...w, projects: w.projects.map((p) =>
                        p.id === action.payload.projectId ? { ...p, tasks: p.tasks.concat(action.payload) } : p
                    )
                } : w
            );
        },
        updateTask: (state, action) => {
            state.currentWorkspace.projects.map((p) => {
                if (p.id === action.payload.projectId) {
                    p.tasks = p.tasks.map((t) =>
                        t.id === action.payload.id ? action.payload : t
                    );
                }
            });
            // find workspace and project by id and update task in it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? {
                    ...w, projects: w.projects.map((p) =>
                        p.id === action.payload.projectId ? {
                            ...p, tasks: p.tasks.map((t) =>
                                t.id === action.payload.id ? action.payload : t
                            )
                        } : p
                    )
                } : w
            );
        },
        deleteTask: (state, action) => {
            state.currentWorkspace.projects.map((p) => {
                p.tasks = p.tasks.filter((t) => !action.payload.includes(t.id));
                return p;
            });
            // find workspace and project by id and delete task from it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? {
                    ...w, projects: w.projects.map((p) =>
                        p.id === action.payload.projectId ? {
                            ...p, tasks: p.tasks.filter((t) => !action.payload.includes(t.id))
                        } : p
                    )
                } : w
            );
        },
        setTaskComments: (state, action) => {
            const { projectId, taskId, comments } = action.payload;
            state.currentWorkspace?.projects?.forEach((project) => {
                if (project.id === projectId) {
                    const task = project.tasks.find((item) => item.id === taskId);
                    if (task) task.comments = comments;
                }
            });
            state.workspaces = state.workspaces.map((workspace) => ({
                ...workspace,
                projects: workspace.projects.map((project) => project.id !== projectId ? project : {
                    ...project,
                    tasks: project.tasks.map((task) => task.id === taskId ? { ...task, comments } : task),
                }),
            }));
        },

    }
});

export const { setWorkspaces, setCurrentWorkspace, setCurrentUser, setAuthenticatedUser, addWorkspace, updateWorkspace, deleteWorkspace, addProject, addTask, updateTask, deleteTask, setTaskComments } = workspaceSlice.actions;
export const selectCurrentUser = (state) => {
    if (state.workspace?.authenticatedUser) return state.workspace.authenticatedUser;
    const workspace = state.workspace?.currentWorkspace;
    return workspace?.members?.find((member) => member.userId === state.workspace?.currentUserId)?.user
        || workspace?.owner
        || workspace?.members?.[0]?.user
        || null;
};
export const selectCurrentRole = (state) => {
    const workspace = state.workspace?.currentWorkspace;
    const userId = state.workspace?.currentUserId;
    return workspace?.members?.find((member) => member.userId === userId)?.role || "MEMBER";
};
export default workspaceSlice.reducer;
