
import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useDispatch } from "react-redux";
import toast from "react-hot-toast";
import { initializeBackend } from "./app/api";
import Layout from "./pages/Layout";
import { Toaster } from "react-hot-toast";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Team from "./pages/Team";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import ProjectDetails from "./pages/ProjectDetails";
import TaskDetails from "./pages/TaskDetails";
import AuthScreen from "./components/AuthScreen";
import { clearAccessToken, getAccessToken } from "./app/api";
import { Loader2Icon } from "lucide-react";

const App = () => {
    const dispatch = useDispatch();
    const [authenticated, setAuthenticated] = useState(Boolean(getAccessToken()));
    const [isInitializing, setIsInitializing] = useState(Boolean(getAccessToken()));

    useEffect(() => {
        if (!authenticated) return undefined;
        let cancelled = false;
        setIsInitializing(true);
        initializeBackend(dispatch).then(() => {
            if (!cancelled) setIsInitializing(false);
        }).catch(() => {
            if (!cancelled) {
                setIsInitializing(false);
                setAuthenticated(false);
            }
        });
        return () => { cancelled = true; };
    }, [authenticated, dispatch]);

    useEffect(() => {
        const handleApiError = (event) => toast.error(`Could not save changes: ${event.detail}`);
        const handleAuthRequired = () => {
            clearAccessToken();
            setAuthenticated(false);
            setIsInitializing(false);
        };
        window.addEventListener("app:api-error", handleApiError);
        window.addEventListener("app:auth-required", handleAuthRequired);
        return () => {
            window.removeEventListener("app:api-error", handleApiError);
            window.removeEventListener("app:auth-required", handleAuthRequired);
        };
    }, []);

    if (!authenticated) return <><Toaster /><AuthScreen onAuthenticated={() => { setIsInitializing(true); setAuthenticated(true); }} /></>;

    if (isInitializing) return (
        <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
            <Loader2Icon className="size-7 animate-spin text-blue-500" />
        </div>
    );

    return (
        <>
            <Toaster />
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="team" element={<Team />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="profile" element={<Profile />} />
                    <Route path="projects" element={<Projects />} />
                    <Route path="projectsDetail" element={<ProjectDetails />} />
                    <Route path="taskDetails" element={<TaskDetails />} />
                </Route>
            </Routes>
        </>
    );
};

export default App;
