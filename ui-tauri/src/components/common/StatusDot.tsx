import { cn } from "@/lib/utils";

interface StatusDotProps {
  online: boolean;
  size?: "sm" | "md";
  className?: string;
}

const sizeMap = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
};

export function StatusDot({ online, size = "md", className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-block rounded-full",
        sizeMap[size],
        online
          ? "bg-[var(--color-online)] animate-status-pulse"
          : "bg-[var(--color-offline)]",
        className
      )}
    />
  );
}
