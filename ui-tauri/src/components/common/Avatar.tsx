import { cn } from "@/lib/utils";

interface AvatarProps {
  username: string;
  size?: "sm" | "md" | "lg";
  online?: boolean;
  className?: string;
}

const gradients = [
  "from-indigo-400 to-violet-500",
  "from-blue-400 to-indigo-500",
  "from-purple-400 to-fuchsia-500",
  "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-500",
  "from-rose-400 to-pink-500",
  "from-sky-400 to-cyan-500",
  "from-violet-400 to-purple-500",
];

function getGradient(username: string) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

export function Avatar({ username, size = "md", online, className }: AvatarProps) {
  const initials = username.slice(0, 2).toUpperCase();
  const gradient = getGradient(username);

  return (
    <div className={cn(`avatar avatar--${size}`, className)}>
      <div className={cn("avatar__circle bg-gradient-to-br", gradient)}>
        {initials}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "avatar__status",
            online ? "avatar__status--online" : "avatar__status--offline"
          )}
        />
      )}
    </div>
  );
}
