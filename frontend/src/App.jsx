
import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useDispatch, useStore } from "react-redux";
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

const App = () => {
    const dispatch = useDispatch();
    const store = useStore();
    const [authenticated, setAuthenticated] = useState(Boolean(getAccessToken()));

    useEffect(() => {
        if (!authenticated) return undefined;
        initializeBackend(dispatch, store.getState).catch(() => setAuthenticated(false));
        return undefined;
    }, [authenticated, dispatch, store]);

    useEffect(() => {
        const handleApiError = (event) => toast.error(`Could not save changes: ${event.detail}`);
        const handleAuthRequired = () => {
            clearAccessToken();
            setAuthenticated(false);
        };
        window.addEventListener("app:api-error", handleApiError);
        window.addEventListener("app:auth-required", handleAuthRequired);
        return () => {
            window.removeEventListener("app:api-error", handleApiError);
            window.removeEventListener("app:auth-required", handleAuthRequired);
        };
    }, []);

    if (!authenticated) return <><Toaster /><AuthScreen onAuthenticated={() => setAuthenticated(true)} /></>;

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
