import { motion } from "framer-motion";
import { Avatar } from "@/components/common/Avatar";
import { Badge } from "@/components/common/Badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { ContactWithPreview } from "@/types/contact";

interface ContactItemProps {
  contact: ContactWithPreview;
  active: boolean;
  onClick: () => void;
}

export function ContactItem({ contact, active, onClick }: ContactItemProps) {
  const timeAgo = contact.lastMessageTime
    ? formatDistanceToNow(new Date(contact.lastMessageTime), { addSuffix: true })
    : contact.online
      ? "Online"
      : contact.last_seen
        ? formatDistanceToNow(new Date(contact.last_seen), { addSuffix: true })
        : "";

  return (
    <motion.button
      onClick={onClick}
      className={cn("contact-item", active && "contact-item--active")}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
    >
      <Avatar username={contact.username} online={contact.online} />

      <div className="contact-item__info">
        <div className="contact-item__row">
          <span className="contact-item__name">{contact.username}</span>
          <span className="contact-item__time">{timeAgo}</span>
        </div>
        <div className="contact-item__row" style={{ marginTop: 2 }}>
          <span className="contact-item__preview">
            {contact.lastMessage || (contact.online ? "Online now" : "Offline")}
          </span>
          <Badge count={contact.unreadCount} />
        </div>
      </div>
    </motion.button>
  );
}
