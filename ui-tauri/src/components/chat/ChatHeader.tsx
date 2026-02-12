import { Avatar } from "@/components/common/Avatar";
import { StatusDot } from "@/components/common/StatusDot";
import { formatDistanceToNow } from "date-fns";
import { Lock, MoreVertical } from "lucide-react";
import { motion } from "framer-motion";

interface ChatHeaderProps {
  username: string;
  online: boolean;
  lastSeen?: string;
}

export function ChatHeader({ username, online, lastSeen }: ChatHeaderProps) {
  const statusText = online
    ? "Online"
    : lastSeen
      ? formatDistanceToNow(new Date(lastSeen), { addSuffix: true })
      : "Offline";

  return (
    <div className="chat-panel__header">
      <div className="chat-header__user">
        <Avatar username={username} online={online} size="md" />
        <div>
          <h3 className="chat-header__name">{username}</h3>
          <div className="chat-header__status">
            <StatusDot online={online} size="sm" />
            <span className="chat-header__status-text">{statusText}</span>
          </div>
        </div>
      </div>

      <div className="chat-header__actions">
        <motion.div
          className="pill"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="pill__icon"><Lock size={10} /></span>
          <span>E2E</span>
        </motion.div>
        <button className="icon-btn">
          <MoreVertical size={15} />
        </button>
      </div>
    </div>
  );
}
