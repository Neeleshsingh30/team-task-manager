import { SearchIcon, PanelLeft, LogOut } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { toggleTheme } from '../features/themeSlice'
import { MoonIcon, SunIcon } from 'lucide-react'
import { selectCurrentUser } from '../features/workspaceSlice'
import { clearAccessToken } from '../app/api'
import { Link } from 'react-router-dom'
import NotificationBell from './NotificationBell'

const Navbar = ({ setIsSidebarOpen }) => {

    const dispatch = useDispatch();
    const { theme } = useSelector(state => state.theme);
    const currentWorkspace = useSelector(state => state.workspace.currentWorkspace);
    const currentUser = useSelector(selectCurrentUser);
    const currentRole = currentWorkspace
        ? currentWorkspace.members?.find((member) => member.userId === currentUser?.id)?.role || "MEMBER"
        : "No workspace";
    const initials = currentUser?.name?.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
        || currentUser?.email?.[0]?.toUpperCase()
        || '?';

    return (
        <div className="w-full bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 px-6 xl:px-16 py-3 flex-shrink-0">
            <div className="flex items-center justify-between max-w-6xl mx-auto">
                {/* Left section */}
                <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Sidebar Trigger */}
                    <button onClick={() => setIsSidebarOpen((prev) => !prev)} className="sm:hidden p-2 rounded-lg transition-colors text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-zinc-800" >
                        <PanelLeft size={20} />
                    </button>

                    {/* Search Input */}
                    <div className="relative flex-1 max-w-sm">
                        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-400 size-3.5" />
                        <input
                            type="text"
                            placeholder="Search projects, tasks..."
                            className="pl-8 pr-4 py-2 w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-md text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition"
                        />
                    </div>
                </div>

                {/* Right section */}
                <div className="flex items-center gap-3">

                    {/* Theme Toggle */}
                    <button onClick={() => dispatch(toggleTheme())} className="size-8 flex items-center justify-center bg-white dark:bg-zinc-800 shadow rounded-lg transition hover:scale-105 active:scale-95">
                        {
                            theme === "light"
                                ? (<MoonIcon className="size-4 text-gray-800 dark:text-gray-200" />)
                                : (<SunIcon className="size-4 text-yellow-400" />)
                        }
                    </button>

                    <NotificationBell />

                    <div className="flex items-center gap-2" title={`${currentUser?.email || ""} · ${currentRole}`}>
                        <Link to="/profile" className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-gray-50 dark:hover:bg-zinc-800" aria-label="Open profile">
                        {currentUser?.image
                            ? <img src={currentUser.image} alt="" className="size-8 rounded-full" />
                            : <span className="flex size-8 items-center justify-center rounded-full bg-blue-900 font-semibold text-white">{initials}</span>}
                        <span className="hidden max-w-36 truncate text-sm sm:block">{currentUser?.name || currentUser?.email || "Account"}<span className="block text-xs text-gray-500">{currentRole}</span></span>
                        </Link>
                        <button type="button" onClick={() => { clearAccessToken(); window.dispatchEvent(new CustomEvent("app:auth-required")); }} aria-label="Sign out" title="Sign out" className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800"><LogOut size={17} /></button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Navbar
