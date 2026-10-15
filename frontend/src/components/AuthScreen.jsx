import { useState } from "react";
import toast from "react-hot-toast";
import { acceptInvitation, login, register, setAccessToken } from "../app/api";

export default function AuthScreen({ onAuthenticated }) {
    const inviteParams = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
    const inviteToken = inviteParams.get("invite");
    const [mode, setMode] = useState(inviteToken ? "register" : "login");
    const [form, setForm] = useState({ name: "", email: "", password: "" });
    const [busy, setBusy] = useState(false);

    const submit = async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
            const session = inviteToken
                ? await acceptInvitation({ ...form, token: inviteToken })
                : mode === "login"
                    ? await login(form.email, form.password)
                    : await register(form.name, form.email, form.password);
            setAccessToken(session.accessToken);
            if (inviteToken) window.history.replaceState({}, "", window.location.pathname);
            onAuthenticated();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-zinc-950">
            <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-xl border border-gray-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Team Task Manager</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{inviteToken ? "Accept your workspace invitation by setting your account password." : "Sign in to access your workspaces."}</p>
                </div>
                {mode === "register" && <label className="block text-sm">Name<input required autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>}
                <label className="block text-sm">Email<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>
                <label className="block text-sm">Password<input required type="password" minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-700" /><span className="mt-1 block text-xs text-gray-500">At least 10 characters.</span></label>
                <button disabled={busy} className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
                <p className="text-center text-sm text-gray-600 dark:text-zinc-400">
                    {!inviteToken && <>{mode === "login" ? "New to this app?" : "Already have an account?"}{" "}
                        <button type="button" className="font-medium text-blue-600" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create account" : "Sign in"}</button></>}
                </p>
            </form>
        </main>
    );
}
