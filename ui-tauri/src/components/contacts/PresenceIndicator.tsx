import { cn } from "@/lib/utils";

interface PresenceIndicatorProps {
  online: boolean;
  className?: string;
}

export function PresenceIndicator({ online, className }: PresenceIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div
        className={cn(
          "h-2 w-2 rounded-full",
          online
            ? "bg-[var(--color-online)] animate-status-pulse"
            : "bg-[var(--color-offline)]"
        )}
      />
      <span
        className={cn(
          "text-xs",
          online ? "text-[var(--color-online)]" : "text-[var(--color-text-muted)]"
        )}
      >
        {online ? "Online" : "Offline"}
      </span>
    </div>
  );
}
