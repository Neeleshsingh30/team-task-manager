import { useEffect, useState } from "react";

export default function Avatar({ src, name, email, className = "" }) {
    const [imageFailed, setImageFailed] = useState(false);
    const initials = (name?.trim()?.[0] || email?.trim()?.[0] || "?").toUpperCase();

    useEffect(() => {
        setImageFailed(false);
    }, [src]);

    if (src && !imageFailed) {
        return <img src={src} alt="" onError={() => setImageFailed(true)} className={`${className} object-cover`} />;
    }

    return (
        <span aria-label={name || email || "User"} className={`${className} flex items-center justify-center overflow-hidden bg-blue-100 font-semibold uppercase text-blue-700 dark:bg-blue-500/20 dark:text-blue-300`}>
            {initials}
        </span>
    );
}
