import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import toast from "react-hot-toast";
import { ArrowLeft, KeyRound, Mail, Save, ShieldCheck, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { changePassword, getWorkspaces, updateProfile } from "../app/api";
import { selectCurrentRole, selectCurrentUser, setAuthenticatedUser, setWorkspaces } from "../features/workspaceSlice";

const fieldClass = "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:focus:ring-blue-950";
const cardClass = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-7";

export default function Profile() {
    const dispatch = useDispatch();
    const user = useSelector(selectCurrentUser);
    const role = useSelector(selectCurrentRole);
    const workspaces = useSelector((state) => state.workspace.workspaces || []);
    const [savingProfile, setSavingProfile] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const [profile, setProfile] = useState({ name: "", email: "", profileImage: "", currentPassword: "" });
    const [password, setPassword] = useState({ current: "", next: "", confirm: "" });

    useEffect(() => {
        setProfile({ name: user?.name || "", email: user?.email || "", profileImage: user?.image || "", currentPassword: "" });
    }, [user?.id, user?.name, user?.email, user?.image]);

    const initials = useMemo(() => (user?.name || user?.email || "U").split(/[\s@]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(), [user?.name, user?.email]);
    const emailChanged = profile.email.trim().toLowerCase() !== (user?.email || "").toLowerCase();

    const saveProfile = async (event) => {
        event.preventDefault();
        setSavingProfile(true);
        try {
            const updated = await updateProfile({
                name: profile.name,
                email: profile.email,
                profileImage: profile.profileImage,
                ...(emailChanged ? { currentPassword: profile.currentPassword } : {}),
            });
            dispatch(setAuthenticatedUser(updated));
            dispatch(setWorkspaces(await getWorkspaces()));
            setProfile((previous) => ({ ...previous, currentPassword: "" }));
            toast.success("Profile saved");
        } catch (error) {
            toast.error(error.message || "Could not save profile");
        } finally {
            setSavingProfile(false);
        }
    };

    const savePassword = async (event) => {
        event.preventDefault();
        if (password.next !== password.confirm) {
            toast.error("New passwords do not match");
            return;
        }
        setSavingPassword(true);
        try {
            await changePassword(password.current, password.next);
            setPassword({ current: "", next: "", confirm: "" });
            toast.success("Password changed successfully");
        } catch (error) {
            toast.error(error.message || "Could not change password");
        } finally {
            setSavingPassword(false);
        }
    };

    return (
        <main className="mx-auto max-w-5xl space-y-6">
            <header className="flex items-start gap-3">
                <Link to="/" aria-label="Back to dashboard" className="mt-1 rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-zinc-800 dark:hover:text-white"><ArrowLeft size={18} /></Link>
                <div>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Account</p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Profile</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Manage your personal details and sign-in password.</p>
                </div>
            </header>

            <section className="flex flex-col gap-5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white shadow-sm sm:flex-row sm:items-center">
                {profile.profileImage ? <img src={profile.profileImage} alt="Profile" className="size-16 rounded-2xl border-2 border-white/30 object-cover" /> : <span className="flex size-16 items-center justify-center rounded-2xl bg-white/15 text-xl font-semibold">{initials}</span>}
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-xl font-semibold">{profile.name || "Your profile"}</h2>
                    <p className="mt-1 truncate text-sm text-blue-100">{profile.email || "Add an email address"}</p>
                </div>
                <div className="flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium sm:self-center"><ShieldCheck size={15} /> {role || "MEMBER"}</div>
            </section>

            <section className={cardClass}>
                <div className="mb-6 flex items-center gap-3">
                    <span className="rounded-xl bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><UserRound size={19} /></span>
                    <div><h2 className="font-semibold text-gray-900 dark:text-white">Personal information</h2><p className="text-sm text-gray-500 dark:text-zinc-400">Your name and profile details shown to teammates.</p></div>
                </div>
                <form onSubmit={saveProfile} className="grid gap-5 md:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-zinc-300">Full name<input required maxLength={100} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} className={fieldClass} placeholder="Your name" /></label>
                    <label className="text-sm font-medium text-gray-700 dark:text-zinc-300">Email address<input required type="email" maxLength={255} value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} className={fieldClass} placeholder="you@example.com" /><span className="mt-1 block text-xs font-normal text-gray-500 dark:text-zinc-400">Changing your email requires your current password.</span></label>
                    <label className="text-sm font-medium text-gray-700 dark:text-zinc-300 md:col-span-2">Profile image URL<input type="url" value={profile.profileImage.startsWith("data:image/") ? "" : profile.profileImage} onChange={(event) => setProfile({ ...profile, profileImage: event.target.value })} className={fieldClass} placeholder="https://example.com/photo.jpg" /><span className="mt-1 block text-xs font-normal text-gray-500 dark:text-zinc-400">Optional. Leave blank to use your initials.</span></label>
                    {emailChanged && <label className="text-sm font-medium text-gray-700 dark:text-zinc-300 md:col-span-2">Current password<input required type="password" autoComplete="current-password" value={profile.currentPassword} onChange={(event) => setProfile({ ...profile, currentPassword: event.target.value })} className={fieldClass} /></label>}
                    <div className="flex justify-end md:col-span-2"><button disabled={savingProfile} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"><Save size={16} />{savingProfile ? "Saving…" : "Save profile"}</button></div>
                </form>
            </section>

            <section className={cardClass}>
                <div className="mb-6 flex items-center gap-3">
                    <span className="rounded-xl bg-violet-50 p-2.5 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300"><KeyRound size={19} /></span>
                    <div><h2 className="font-semibold text-gray-900 dark:text-white">Password & security</h2><p className="text-sm text-gray-500 dark:text-zinc-400">Use your current password to set a new one.</p></div>
                </div>
                <form onSubmit={savePassword} className="grid gap-5 md:grid-cols-3">
                    <label className="text-sm font-medium text-gray-700 dark:text-zinc-300">Current password<input required type="password" autoComplete="current-password" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} className={fieldClass} /></label>
                    <label className="text-sm font-medium text-gray-700 dark:text-zinc-300">New password<input required minLength={10} type="password" autoComplete="new-password" value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} className={fieldClass} /><span className="mt-1 block text-xs font-normal text-gray-500 dark:text-zinc-400">At least 10 characters.</span></label>
                    <label className="text-sm font-medium text-gray-700 dark:text-zinc-300">Confirm new password<input required minLength={10} type="password" autoComplete="new-password" value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} className={fieldClass} /></label>
                    <div className="flex justify-end md:col-span-3"><button disabled={savingPassword} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:opacity-60 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-800"><KeyRound size={16} />{savingPassword ? "Updating…" : "Update password"}</button></div>
                </form>
            </section>

            <section className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                <Mail size={17} className="mt-0.5 shrink-0" /><p>Email changes update your sign-in address for this account. Your workspace memberships remain attached to your account.</p>
            </section>
            <p className="text-xs text-gray-400">Member of {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}.</p>
        </main>
    );
}
