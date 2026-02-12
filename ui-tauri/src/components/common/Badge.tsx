import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BadgeProps {
  count: number;
  className?: string;
}

export function Badge({ count, className }: BadgeProps) {
  if (count <= 0) return null;
  return (
    <motion.span
      className={cn("badge", className)}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 20 }}
    >
      {count > 99 ? "99+" : count}
    </motion.span>
  );
}
