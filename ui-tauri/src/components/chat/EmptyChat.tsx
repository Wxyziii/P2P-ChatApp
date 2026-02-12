import { motion } from "framer-motion";
import { MessageCircle, Shield, Globe, Lock } from "lucide-react";
import { fadeIn } from "@/lib/animations";

export function EmptyChat() {
  return (
    <motion.div
      className="empty-chat"
      variants={fadeIn}
      initial="hidden"
      animate="visible"
    >
      <div className="flex flex-col items-center gap-6 -mt-12">
        {/* Animated icon */}
        <motion.div
          className="relative"
          animate={{
            scale: [1, 1.04, 1],
            transition: { repeat: Infinity, duration: 4, ease: "easeInOut" },
          }}
        >
          <div className="p-7 rounded-3xl bg-gradient-to-br from-indigo-500/10 to-indigo-400/5 shadow-[var(--shadow-sm)]">
            <MessageCircle size={44} className="text-[#6366f1]" strokeWidth={1.5} />
          </div>
          <div className="absolute -bottom-1 -right-1 p-1.5 rounded-xl bg-[var(--color-bg-base)] shadow-[var(--shadow-sm)]">
            <Lock size={14} className="text-[#6366f1]" />
          </div>
        </motion.div>

        {/* Text */}
        <div className="text-center max-w-sm">
          <h3 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2 tracking-tight">
            P2P Chat
          </h3>
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
            Select a conversation or add a friend to start messaging.
            <br />
            All messages are end-to-end encrypted.
          </p>
        </div>

        {/* Feature badges */}
        <div className="flex items-center gap-3">
          <FeatureBadge icon={<Shield size={13} />} label="E2E Encrypted" />
          <FeatureBadge icon={<Globe size={13} />} label="Peer-to-Peer" />
        </div>
      </div>
    </motion.div>
  );
}

function FeatureBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="pill">
      <span className="pill__icon">{icon}</span>
      {label}
    </div>
  );
}
