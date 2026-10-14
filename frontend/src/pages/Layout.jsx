import { useState, useEffect } from 'react'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import { Outlet } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { loadTheme } from '../features/themeSlice'
import { Loader2Icon } from 'lucide-react'
import { API_BASE_URL, getAccessToken, getWorkspaces } from '../app/api'
import { setWorkspaces } from '../features/workspaceSlice'

const Layout = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const { loading } = useSelector((state) => state.workspace)
    const dispatch = useDispatch()
    const currentWorkspaceId = useSelector((state) => state.workspace.currentWorkspace?.id)

    // Initial load of theme
    useEffect(() => {
        dispatch(loadTheme())
    }, [dispatch])

    useEffect(() => {
        if (!currentWorkspaceId) return undefined
        let socket
        let reconnectTimer
        let stopped = false
        let retryDelay = 1000
        const connect = () => {
            if (stopped) return
            const apiBase = API_BASE_URL.replace(/\/api\/?$/, '')
            const wsBase = apiBase.replace(/^http/, 'ws')
            socket = new WebSocket(`${wsBase}/api/ws/workspaces/${encodeURIComponent(currentWorkspaceId)}`, ['bearer', getAccessToken() || ''])
            socket.onopen = () => { retryDelay = 1000 }
            socket.onmessage = async (event) => {
                if (JSON.parse(event.data).type !== 'workspace.refresh') return
                try {
                    dispatch(setWorkspaces(await getWorkspaces()))
                    window.dispatchEvent(new Event('app:workspace-refresh'))
                } catch { /* HTTP auth handler owns session errors. */ }
            }
            socket.onclose = (event) => {
                if (event.code === 4401) {
                    window.dispatchEvent(new CustomEvent('app:auth-required'))
                    return
                }
                if (!stopped) {
                    reconnectTimer = window.setTimeout(connect, retryDelay)
                    retryDelay = Math.min(retryDelay * 2, 15000)
                }
            }
        }
        connect()
        return () => {
            stopped = true
            window.clearTimeout(reconnectTimer)
            socket?.close()
        }
    }, [currentWorkspaceId, dispatch])

    if (loading) return (
        <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
            <Loader2Icon className="size-7 text-blue-500 animate-spin" />
        </div>
    )

    return (
        <div className="flex bg-white dark:bg-zinc-950 text-gray-900 dark:text-slate-100">
            <Sidebar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
            <div className="flex-1 flex flex-col h-screen">
                <Navbar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
                <div className="flex-1 h-full p-6 xl:p-10 xl:px-16 overflow-y-scroll">
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

export default Layout
