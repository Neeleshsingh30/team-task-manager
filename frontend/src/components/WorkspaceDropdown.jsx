import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Plus, X, Pencil, Trash2 } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { addWorkspace, deleteWorkspace, selectCurrentUser, setCurrentWorkspace, updateWorkspace } from "../features/workspaceSlice";
import { useNavigate } from "react-router-dom";
import Avatar from "./Avatar";
import toast from "react-hot-toast";

function WorkspaceDropdown() {

    const { workspaces, currentUserId } = useSelector((state) => state.workspace);
    const currentWorkspace = useSelector((state) => state.workspace?.currentWorkspace || null);
    const currentUser = useSelector(selectCurrentUser);
    const [isOpen, setIsOpen] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [editingWorkspace, setEditingWorkspace] = useState(null);
    const [workspaceName, setWorkspaceName] = useState("");
    const [workspaceDescription, setWorkspaceDescription] = useState("");
    const [workspaceImageUrl, setWorkspaceImageUrl] = useState("");
    const dropdownRef = useRef(null);

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const onSelectWorkspace = (organizationId) => {
        dispatch(setCurrentWorkspace(organizationId))
        setIsOpen(false);
        navigate('/')
    }

    const onCreateWorkspace = (event) => {
        event.preventDefault();
        const name = workspaceName.trim();
        if (!name) return;

        if (editingWorkspace) {
            dispatch(updateWorkspace({
                ...editingWorkspace,
                name,
                description: workspaceDescription.trim() || null,
                image_url: workspaceImageUrl.trim(),
                updatedAt: new Date().toISOString(),
            }));
            setIsCreateOpen(false);
            setEditingWorkspace(null);
            toast.success("Workspace updated");
            return;
        }

        const owner = currentUser || currentWorkspace?.owner || currentWorkspace?.members?.[0]?.user;
        if (!owner) {
            toast.error("Could not find a workspace owner");
            return;
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const workspace = {
            id,
            name,
            slug: `${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${id.slice(0, 6)}`,
            description: workspaceDescription.trim() || null,
            settings: {},
            ownerId: owner.id,
            owner,
            createdAt: now,
            updatedAt: now,
            image_url: workspaceImageUrl.trim(),
            members: [{
                id: crypto.randomUUID(),
                userId: owner.id,
                workspaceId: id,
                message: "",
                role: "ADMIN",
                user: owner,
            }],
            projects: [],
        };

        dispatch(addWorkspace(workspace));
        setWorkspaceName("");
        setWorkspaceDescription("");
        setWorkspaceImageUrl("");
        setIsCreateOpen(false);
        setIsOpen(false);
        navigate("/");
        toast.success("Workspace created");
    };

    const openCreateDialog = () => {
        setEditingWorkspace(null);
        setWorkspaceName("");
        setWorkspaceDescription("");
        setWorkspaceImageUrl("");
        setIsOpen(false);
        setIsCreateOpen(true);
    };

    const openEditDialog = (workspace) => {
        setEditingWorkspace(workspace);
        setWorkspaceName(workspace.name || "");
        setWorkspaceDescription(workspace.description || "");
        setWorkspaceImageUrl(workspace.image_url || "");
        setIsOpen(false);
        setIsCreateOpen(true);
    };

    const onDeleteWorkspace = (workspace) => {
        if (workspaces.length <= 1) {
            toast.error("You must keep at least one workspace");
            return;
        }
        if (!window.confirm(`Delete workspace “${workspace.name}” and all its projects and tasks?`)) return;

        const wasCurrent = currentWorkspace?.id === workspace.id;
        const nextWorkspace = workspaces.find((item) => item.id !== workspace.id);
        dispatch(deleteWorkspace(workspace.id));
        if (wasCurrent && nextWorkspace) {
            dispatch(setCurrentWorkspace(nextWorkspace.id));
            navigate("/");
        }
        toast.success("Workspace deleted");
    };

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="relative m-4" ref={dropdownRef}>
            <button onClick={() => setIsOpen(prev => !prev)} className="w-full flex items-center justify-between p-3 h-auto text-left rounded hover:bg-gray-100 dark:hover:bg-zinc-800" >
                <div className="flex items-center gap-3">
                    <Avatar src={currentWorkspace?.image_url} name={currentWorkspace?.name} className="size-8 rounded shadow" />
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-800 dark:text-white text-sm truncate">
                            {currentWorkspace?.name || "Select Workspace"}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">
                            {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}
                        </p>
                    </div>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500 dark:text-zinc-400 flex-shrink-0" />
            </button>

            {isOpen && (
                <div className="absolute z-50 w-64 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded shadow-lg top-full left-0">
                    <div className="p-2">
                        <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2 px-2">
                            Workspaces
                        </p>
                        {workspaces.map((ws) => (
                            <div key={ws.id} className="flex items-center gap-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800">
                                <button type="button" onClick={() => onSelectWorkspace(ws.id)} className="min-w-0 flex-1 text-left flex items-center gap-3 p-2 cursor-pointer rounded" >
                                    <Avatar src={ws.image_url} name={ws.name} className="size-6 rounded" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{ws.name}</p>
                                        <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">{ws.members?.length || 0} members</p>
                                    </div>
                                    {currentWorkspace?.id === ws.id && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />}
                                </button>
                                {ws.members?.some((member) => member.userId === currentUserId && member.role === "ADMIN") && <>
                                    <button type="button" title={`Edit ${ws.name}`} aria-label={`Edit ${ws.name}`} onClick={() => openEditDialog(ws)} className="rounded p-2 text-gray-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400"><Pencil className="size-3.5" /></button>
                                    <button type="button" title={`Delete ${ws.name}`} aria-label={`Delete ${ws.name}`} onClick={() => onDeleteWorkspace(ws)} className="rounded p-2 text-gray-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"><Trash2 className="size-3.5" /></button>
                                </>}
                            </div>
                        ))}
                    </div>

                    <hr className="border-gray-200 dark:border-zinc-700" />

                    <button type="button" onClick={openCreateDialog} className="w-full text-left p-2 cursor-pointer rounded group hover:bg-gray-100 dark:hover:bg-zinc-800" >
                        <p className="flex items-center text-xs gap-2 my-1 w-full text-blue-600 dark:text-blue-400 group-hover:text-blue-500 dark:group-hover:text-blue-300">
                            <Plus className="w-4 h-4" /> Create Workspace
                        </p>
                    </button>
                </div>
            )}

            {isCreateOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCreateOpen(false); }}>
                    <form onSubmit={onCreateWorkspace} className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                        <div className="mb-5 flex items-center justify-between">
                            <h2 className="text-lg font-semibold">{editingWorkspace ? "Edit workspace" : "Create workspace"}</h2>
                            <button type="button" onClick={() => { setIsCreateOpen(false); setEditingWorkspace(null); }} aria-label="Close dialog" className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="size-5" /></button>
                        </div>
                        <label className="mb-4 block text-sm">
                            Workspace name
                            <input autoFocus required maxLength={60} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="e.g. Marketing Team" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
                        </label>
                        <label className="mb-5 block text-sm">
                            Description <span className="text-zinc-500">(optional)</span>
                            <textarea maxLength={240} value={workspaceDescription} onChange={(event) => setWorkspaceDescription(event.target.value)} placeholder="What is this workspace for?" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
                        </label>
                        <label className="mb-5 block text-sm">
                            Workspace image URL <span className="text-zinc-500">(optional)</span>
                            <input type="url" value={workspaceImageUrl} onChange={(event) => setWorkspaceImageUrl(event.target.value)} placeholder="https://example.com/workspace.png" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
                            <span className="mt-1 block text-xs text-zinc-500">Use a direct, publicly accessible image URL. Leave blank to show the workspace initial.</span>
                        </label>
                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => { setIsCreateOpen(false); setEditingWorkspace(null); }} className="rounded border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Cancel</button>
                            <button type="submit" disabled={!workspaceName.trim()} className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{editingWorkspace ? "Save changes" : "Create workspace"}</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

export default WorkspaceDropdown;
