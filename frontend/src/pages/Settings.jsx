import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowRight, Check, FolderKanban, Moon, Settings as SettingsIcon, Shield, Sun, Users } from "lucide-react";
import { getWorkspaces, saveWorkspace } from "../app/api";
import { selectCurrentRole, setWorkspaces } from "../features/workspaceSlice";
import { toggleTheme } from "../features/themeSlice";
import Avatar from "../components/Avatar";

const cardClass = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-7";
const fieldClass = "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:focus:ring-blue-950";

export default function Settings() {
    const dispatch = useDispatch();
    const workspace = useSelector((state) => state.workspace.currentWorkspace);
    const workspaces = useSelector((state) => state.workspace.workspaces || []);
    const role = useSelector(selectCurrentRole);
    const theme = useSelector((state) => state.theme.theme);
    const isAdmin = role === "ADMIN";
    const [saving, setSaving] = useState(false);
    const [details, setDetails] = useState({ name: "", description: "", imageUrl: "" });

    useEffect(() => {
        setDetails({ name: workspace?.name || "", description: workspace?.description || "", imageUrl: workspace?.image_url || "" });
    }, [workspace?.id, workspace?.name, workspace?.description, workspace?.image_url]);

    const projects = workspace?.projects || [];
    const memberCount = workspace?.members?.length || 0;
    const taskCount = projects.reduce((sum, project) => sum + (project.tasks?.length || 0), 0);

    const saveDetails = async (event) => {
        event.preventDefault();
        if (!workspace || !isAdmin) return;
        setSaving(true);
        try {
            await saveWorkspace({ ...workspace, name: details.name.trim(), description: details.description.trim(), image_url: details.imageUrl.trim() });
            dispatch(setWorkspaces(await getWorkspaces()));
            toast.success("Workspace settings saved");
        } catch (error) {
            toast.error(error.message || "Could not save workspace settings");
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="mx-auto max-w-5xl space-y-6">
            <header>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Preferences & workspace</p>
                <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white"><SettingsIcon size={23} /> Settings</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Manage how the app looks and the details of your active workspace.</p>
            </header>

            <section className={cardClass}>
                <div className="mb-5 flex items-center gap-3">
                    <span className="rounded-xl bg-amber-50 p-2.5 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">{theme === "dark" ? <Moon size={19} /> : <Sun size={19} />}</span>
                    <div><h2 className="font-semibold text-gray-900 dark:text-white">Appearance</h2><p className="text-sm text-gray-500 dark:text-zinc-400">Choose the theme for this browser.</p></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    {[{ value: "light", label: "Light", Icon: Sun }, { value: "dark", label: "Dark", Icon: Moon }].map(({ value, label, Icon }) => (
                        <button key={value} type="button" onClick={() => { if (theme !== value) dispatch(toggleTheme()); }} className={`flex items-center justify-between rounded-xl border p-4 text-left transition ${theme === value ? "border-blue-500 bg-blue-50/70 ring-1 ring-blue-500 dark:bg-blue-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}>
                            <span className="flex items-center gap-3"><span className="rounded-lg bg-white p-2 text-gray-700 shadow-sm dark:bg-zinc-900 dark:text-zinc-200"><Icon size={17} /></span><span className="text-sm font-medium text-gray-800 dark:text-zinc-100">{label} mode</span></span>
                            {theme === value && <Check size={17} className="text-blue-600 dark:text-blue-400" />}
                        </button>
                    ))}
                </div>
            </section>

            <section className={cardClass}>
                <div className="mb-6 flex items-center gap-3">
                    <Avatar src={workspace?.image_url} name={workspace?.name} className="size-10 rounded-xl" />
                    <div className="min-w-0"><h2 className="font-semibold text-gray-900 dark:text-white">Active workspace</h2><p className="text-sm text-gray-500 dark:text-zinc-400">Settings for {workspace?.name || "your selected workspace"}.</p></div>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 dark:bg-zinc-800 dark:text-zinc-300"><Shield size={13} /> {role}</span>
                </div>
                {workspace ? <>
                    <form onSubmit={saveDetails} className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Workspace name<input required maxLength={150} disabled={!isAdmin} value={details.name} onChange={(event) => setDetails({ ...details, name: event.target.value })} className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-zinc-800`} /></label>
                        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Description<textarea maxLength={2000} rows={3} disabled={!isAdmin} value={details.description} onChange={(event) => setDetails({ ...details, description: event.target.value })} className={`${fieldClass} resize-y disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-zinc-800`} placeholder="What does this workspace manage?" /></label>
                        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">Workspace image URL<input type="url" disabled={!isAdmin} value={details.imageUrl} onChange={(event) => setDetails({ ...details, imageUrl: event.target.value })} className={`${fieldClass} disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-zinc-800`} placeholder="https://example.com/workspace.png" /><span className="mt-1 block text-xs font-normal text-gray-500 dark:text-zinc-400">Use a direct, publicly accessible image URL. Leave blank to show the workspace initial.</span></label>
                        {isAdmin ? <div className="flex justify-end"><button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Save workspace"}</button></div> : <p className="text-xs text-gray-500 dark:text-zinc-400">Only workspace admins can edit workspace details. Ask an admin if these details need to change.</p>}
                    </form>
                    <div className="mt-6 grid gap-3 border-t border-gray-100 pt-5 dark:border-zinc-800 sm:grid-cols-3">
                        {[{ label: "Members", value: memberCount, Icon: Users }, { label: "Projects", value: projects.length, Icon: FolderKanban }, { label: "Tasks", value: taskCount, Icon: Check }].map(({ label, value, Icon }) => <div key={label} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-zinc-800/60"><span className="rounded-lg bg-white p-2 text-gray-500 dark:bg-zinc-900 dark:text-zinc-300"><Icon size={16} /></span><div><p className="text-lg font-semibold text-gray-900 dark:text-white">{value}</p><p className="text-xs text-gray-500 dark:text-zinc-400">{label}</p></div></div>)}
                    </div>
                </> : <p className="rounded-xl bg-gray-50 p-5 text-sm text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">Select or create a workspace to manage its settings.</p>}
            </section>

            <section className={cardClass}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <span className="rounded-xl bg-violet-50 p-2.5 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300"><UserRoundIcon /></span>
                    <div className="flex-1"><h2 className="font-semibold text-gray-900 dark:text-white">Your account</h2><p className="text-sm text-gray-500 dark:text-zinc-400">Update your profile details, email, and password.</p></div>
                    <Link to="/profile" className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 transition hover:bg-gray-50 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-800">Open profile <ArrowRight size={16} /></Link>
                </div>
            </section>

            <p className="text-xs text-gray-400">You have access to {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}. Workspace changes apply to everyone in the active workspace.</p>
        </main>
    );
}

function UserRoundIcon() {
    return <Users size={19} />;
}
