import { useRef, useState } from "react";
import { Copy, Mail, UserPlus } from "lucide-react";
import { useSelector } from "react-redux";
import toast from "react-hot-toast";
import { createInvitation } from "../app/api";

const InviteMemberDialog = ({ isDialogOpen, setIsDialogOpen }) => {

    const currentWorkspace = useSelector((state) => state.workspace?.currentWorkspace || null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [inviteUrl, setInviteUrl] = useState("");
    const [delivery, setDelivery] = useState("");
    const [deliveryMessage, setDeliveryMessage] = useState("");
    const inviteLinkInput = useRef(null);
    const [formData, setFormData] = useState({
        email: "",
        role: "org:member",
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!currentWorkspace) return;
        const email = formData.email.trim().toLowerCase();
        setIsSubmitting(true);
        setDelivery("");
        setDeliveryMessage("");
        try {
            const invite = await createInvitation(currentWorkspace.id, email, formData.role === "org:admin" ? "ADMIN" : "MEMBER");
            const link = invite.inviteUrl || `${window.location.origin}/#/?invite=${encodeURIComponent(invite.inviteToken)}`;
            setInviteUrl(link);
            setDelivery(invite.delivery);
            setDeliveryMessage(invite.deliveryError || invite.deliveryHint || "");
            try {
                if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
                await navigator.clipboard?.writeText(link);
                if (invite.delivery === "email") toast.success(`Invitation email sent to ${email}; backup link copied`);
                else if (invite.delivery === "email_failed") toast.error(invite.deliveryError ? `Email failed: ${invite.deliveryError}` : "Email could not be sent; invitation link copied as a fallback");
                else toast.success("Email is not configured on the server; invitation link copied");
            } catch {
                if (invite.delivery === "email") toast.success(`Invitation email sent to ${email}. Copy the backup link below if needed.`);
                else if (invite.delivery === "email_failed") toast.error(invite.deliveryError ? `Email failed: ${invite.deliveryError}` : "Email could not be sent. Copy the invitation link below.");
                else toast.success("Email is not configured on the server. Copy the invitation link below.");
            }
        } catch (error) {
            toast.error(error.message || "Could not add member");
        } finally {
            setIsSubmitting(false);
        }
    };

    const copyInviteLink = async () => {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            toast.success("Invitation link copied");
        } catch {
            inviteLinkInput.current?.focus();
            inviteLinkInput.current?.select();
            toast("Link selected. Press Ctrl+C to copy it.");
        }
    };

    if (!isDialogOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/20 dark:bg-black/50 backdrop-blur flex items-center justify-center z-50">
            <div className="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl p-6 w-full max-w-md text-zinc-900 dark:text-zinc-200">
                {/* Header */}
            <div className="mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <UserPlus className="size-5 text-zinc-900 dark:text-zinc-200" /> Invite Team Member
                    </h2>
                    {currentWorkspace && (
                        <p className="text-sm text-zinc-700 dark:text-zinc-400">
                            Inviting to workspace: <span className="text-blue-600 dark:text-blue-400">{currentWorkspace.name}</span>
                        </p>
                    )}
                </div>

                {inviteUrl && <div className="mb-4 rounded bg-emerald-50 p-3 text-sm dark:bg-emerald-950"><p className="mb-2">{delivery === "email" ? `Invitation email sent to ${formData.email}. Backup link (expires in 7 days):` : delivery === "email_failed" ? `Email delivery failed. Share this invitation link (expires in 7 days):` : `Email is not configured. Share this invitation link (expires in 7 days):`}</p>{deliveryMessage && <p className="mb-2 text-xs text-zinc-700 dark:text-zinc-300">{deliveryMessage}</p>}<div className="flex gap-2"><input ref={inviteLinkInput} readOnly value={inviteUrl} className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-xs text-zinc-800" onFocus={(event) => event.target.select()} /><button type="button" onClick={copyInviteLink} className="inline-flex shrink-0 items-center gap-1 rounded bg-white px-2 py-1 text-xs font-medium text-zinc-800 ring-1 ring-zinc-300 hover:bg-zinc-100"><Copy size={13} />Copy link</button></div></div>}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Email */}
                    <div className="space-y-2">
                        <label htmlFor="email" className="text-sm font-medium text-zinc-900 dark:text-zinc-200">
                            Email Address
                        </label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 w-4 h-4" />
                            <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="Enter email address" className="pl-10 mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 text-sm placeholder-zinc-400 dark:placeholder-zinc-500 py-2 focus:outline-none focus:border-blue-500" required />
                        </div>
                    </div>

                    {/* Role */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-900 dark:text-zinc-200">Role</label>
                        <select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="w-full rounded border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-200 py-2 px-3 mt-1 focus:outline-none focus:border-blue-500 text-sm" >
                            <option value="org:member">Member</option>
                            <option value="org:admin">Admin</option>
                        </select>
                    </div>

                    {/* Footer */}
                    <div className="flex justify-end gap-3 pt-2">
                        <button type="button" onClick={() => setIsDialogOpen(false)} className="px-5 py-2 rounded text-sm border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition" >
                            Cancel
                        </button>
                        <button type="submit" disabled={isSubmitting || !currentWorkspace} className="px-5 py-2 rounded text-sm bg-gradient-to-br from-blue-500 to-blue-600 text-white disabled:opacity-50 hover:opacity-90 transition" >
                            {isSubmitting ? "Sending invitation..." : "Send Invitation"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default InviteMemberDialog;
