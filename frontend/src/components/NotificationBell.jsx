import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../app/api";

export default function NotificationBell() {
    const [notifications, setNotifications] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isMarkingAll, setIsMarkingAll] = useState(false);
    const unreadCount = useMemo(() => notifications.filter((item) => !item.isRead).length, [notifications]);

    const refresh = useCallback(async () => {
        try {
            setNotifications(await getNotifications());
        } catch {
            // Keep the header quiet when notifications are temporarily unavailable.
        }
    }, []);

    useEffect(() => {
        refresh();
        const timer = window.setInterval(refresh, 15000);
        window.addEventListener("app:workspace-refresh", refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("app:workspace-refresh", refresh);
        };
    }, [refresh]);

    const markRead = async (id) => {
        const previous = notifications;
        setNotifications((items) => items.map((item) => item.id === id ? { ...item, isRead: true } : item));
        try {
            await markNotificationRead(id);
        } catch (error) {
            setNotifications(previous);
            toast.error(error.message || "Could not update notification");
        }
    };

    const markAllRead = async () => {
        if (!unreadCount) return;
        setIsMarkingAll(true);
        try {
            await markAllNotificationsRead();
            setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
        } catch (error) {
            toast.error(error.message || "Could not update notifications");
        } finally {
            setIsMarkingAll(false);
        }
    };

    return (
        <div className="relative">
            <button type="button" onClick={() => { const next = !isOpen; setIsOpen(next); if (next) refresh(); }} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={isOpen} className="relative flex size-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                <Bell size={17} />
                {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {isOpen && <section className="absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
                    <div><h2 className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</h2><p className="text-xs text-gray-500 dark:text-zinc-400">{unreadCount ? `${unreadCount} unread` : "You're all caught up"}</p></div>
                    <button type="button" disabled={!unreadCount || isMarkingAll} onClick={markAllRead} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-default disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-950"><CheckCheck size={14} />{isMarkingAll ? "Saving…" : "Mark all read"}</button>
                </header>
                <div className="max-h-[24rem] overflow-y-auto">
                    {notifications.length === 0 ? <div className="px-5 py-10 text-center"><span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400"><Bell size={18} /></span><p className="text-sm font-medium text-gray-800 dark:text-zinc-200">No notifications yet</p><p className="mt-1 text-xs text-gray-500 dark:text-zinc-500">Task updates and invitations will appear here.</p></div> : notifications.map((item) => (
                        <article key={item.id} className={`flex gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-zinc-800 ${item.isRead ? "bg-white dark:bg-zinc-900" : "bg-blue-50/70 dark:bg-blue-950/30"}`}>
                            <span className={`mt-1 size-2 shrink-0 rounded-full ${item.isRead ? "bg-gray-300 dark:bg-zinc-700" : "bg-blue-600"}`} />
                            <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-gray-900 dark:text-white">{item.title}</h3><p className="mt-0.5 text-sm leading-5 text-gray-600 dark:text-zinc-300">{item.message}</p><p className="mt-1.5 text-xs text-gray-400 dark:text-zinc-500">{item.createdAt ? formatDistanceToNow(new Date(item.createdAt), { addSuffix: true }) : "Just now"}</p></div>
                            {!item.isRead && <button type="button" onClick={() => markRead(item.id)} aria-label="Mark as read" title="Mark as read" className="self-start rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-blue-600 dark:hover:bg-zinc-800"><Check size={15} /></button>}
                        </article>
                    ))}
                </div>
            </section>}
        </div>
    );
}
