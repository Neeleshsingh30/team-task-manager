import { useState } from "react";
import toast from "react-hot-toast";
import { acceptInvitation, login, register, requestPasswordReset, resetPassword, setAccessToken } from "../app/api";

export default function AuthScreen({ onAuthenticated }) {
    const inviteParams = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
    const inviteToken = inviteParams.get("invite");
    const resetToken = inviteParams.get("reset");
    const [mode, setMode] = useState(resetToken ? "reset" : inviteToken ? "register" : "login");
    const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
    const [busy, setBusy] = useState(false);

    const submit = async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
            if (mode === "forgot") {
                await requestPasswordReset(form.email);
                toast.success("If an account exists for that email, password reset instructions have been sent.");
                setMode("login");
                return;
            }
            if (mode === "reset") {
                if (form.password !== form.confirmPassword) throw new Error("Passwords do not match");
                await resetPassword(resetToken, form.password);
                window.history.replaceState({}, "", window.location.pathname);
                toast.success("Password reset. Sign in with your new password.");
                setForm({ name: "", email: "", password: "", confirmPassword: "" });
                setMode("login");
                return;
            }

            const session = inviteToken && mode === "register"
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

    const title = mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Team Task Manager";
    const description = mode === "forgot"
        ? "Enter your account email and we’ll send a reset link if it exists."
        : mode === "reset"
            ? "Choose a new password for your account. This link expires in 30 minutes."
            : inviteToken
                ? "Accept your workspace invitation using your account password."
                : "Sign in to access your workspaces.";

    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-zinc-950">
            <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-xl border border-gray-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{title}</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{description}</p>
                </div>
                {mode === "register" && <label className="block text-sm">Name<input required autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>}
                {mode !== "reset" && <label className="block text-sm">Email<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>}
                {(mode === "login" || mode === "register" || mode === "reset") && <label className="block text-sm">{mode === "reset" ? "New password" : "Password"}<input required type="password" minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-700" /><span className="mt-1 block text-xs text-gray-500">At least 10 characters.</span></label>}
                {mode === "reset" && <label className="block text-sm">Confirm new password<input required type="password" minLength={10} autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} className="mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>}
                <button disabled={busy} className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">
                    {busy ? "Please wait…" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Update password" : mode === "login" ? "Sign in" : inviteToken ? "Accept invitation" : "Create account"}
                </button>
                <div className="text-center text-sm text-gray-600 dark:text-zinc-400">
                    {mode === "login" && <button type="button" className="font-medium text-blue-600" onClick={() => setMode("forgot")}>Forgot password?</button>}
                    {mode === "register" && <button type="button" className="font-medium text-blue-600" onClick={() => setMode("forgot")}>Already have an account? Forgot password?</button>}
                    {mode === "forgot" && <button type="button" className="font-medium text-blue-600" onClick={() => setMode(inviteToken ? "register" : "login")}>Back to sign in</button>}
                    {!inviteToken && mode === "login" && <> New to this app?{" "}<button type="button" className="font-medium text-blue-600" onClick={() => setMode("register")}>Create account</button></>}
                    {!inviteToken && mode === "register" && <> Already have an account?{" "}<button type="button" className="font-medium text-blue-600" onClick={() => setMode("login")}>Sign in</button></>}
                </div>
            </form>
        </main>
    );
}
