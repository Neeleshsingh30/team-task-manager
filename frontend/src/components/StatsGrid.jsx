import { FolderOpen, CheckCircle, Users, AlertTriangle } from "lucide-react";
import { createElement } from "react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentUser } from "../features/workspaceSlice";

export default function StatsGrid() {
    const currentWorkspace = useSelector(
        (state) => state?.workspace?.currentWorkspace || null
    );
    const currentUser = useSelector(selectCurrentUser);

    const [stats, setStats] = useState({
        totalProjects: 0,
        activeProjects: 0,
        completedProjects: 0,
        myTasks: 0,
        overdueIssues: 0,
    });

    const statCards = [
        {
            icon: FolderOpen,
            title: "Total Projects",
            value: stats.totalProjects,
            subtitle: currentWorkspace ? `projects in ${currentWorkspace.name}` : "Create a workspace to get started",
            bgColor: "bg-blue-500/10",
            textColor: "text-blue-500",
        },
        {
            icon: CheckCircle,
            title: "Completed Projects",
            value: stats.completedProjects,
            subtitle: `of ${stats.totalProjects} total`,
            bgColor: "bg-emerald-500/10",
            textColor: "text-emerald-500",
        },
        {
            icon: Users,
            title: "My Tasks",
            value: stats.myTasks,
            subtitle: "assigned to me",
            bgColor: "bg-purple-500/10",
            textColor: "text-purple-500",
        },
        {
            icon: AlertTriangle,
            title: "Overdue",
            value: stats.overdueIssues,
            subtitle: "need attention",
            bgColor: "bg-amber-500/10",
            textColor: "text-amber-500",
        },
    ];

    useEffect(() => {
        if (!currentWorkspace) {
            setStats({ totalProjects: 0, activeProjects: 0, completedProjects: 0, myTasks: 0, overdueIssues: 0 });
            return;
        }

        const projects = currentWorkspace.projects || [];
        const tasks = projects.flatMap((project) => project.tasks || []);
        setStats({
            totalProjects: projects.length,
            activeProjects: projects.filter((project) => !["CANCELLED", "COMPLETED"].includes(project.status)).length,
            completedProjects: projects.filter((project) => project.status === "COMPLETED").length,
            myTasks: tasks.filter((task) => (task.assignee?.id || task.assigneeId) === currentUser?.id).length,
            overdueIssues: tasks.filter((task) => task.due_date && new Date(task.due_date) < new Date() && task.status !== "DONE").length,
        });
    }, [currentWorkspace, currentUser?.id]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 my-9">
            {statCards.map(
                ({ icon: Icon, title, value, subtitle, bgColor, textColor }, i) => (
                    <div key={i} className="bg-white dark:bg-zinc-950 dark:bg-gradient-to-br dark:from-zinc-800/70 dark:to-zinc-900/50 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition duration-200 rounded-md" >
                        <div className="p-6 py-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
                                        {title}
                                    </p>
                                    <p className="text-3xl font-bold text-zinc-800 dark:text-white">
                                        {value}
                                    </p>
                                    {subtitle && (
                                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                                            {subtitle}
                                        </p>
                                    )}
                                </div>
                                <div className={`p-3 rounded-xl ${bgColor} bg-opacity-20`}>
                                    {createElement(Icon, { size: 20, className: textColor })}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            )}
        </div>
    );
}
