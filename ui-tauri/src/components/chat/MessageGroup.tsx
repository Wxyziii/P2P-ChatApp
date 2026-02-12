import { motion } from "framer-motion";
import { MessageBubble } from "./MessageBubble";
import type { MessageGroup as MsgGroupType } from "@/types/message";
import { format, isToday, isYesterday } from "date-fns";
import { messagePopIn } from "@/lib/animations";
import { cn } from "@/lib/utils";

interface MessageGroupProps {
  group: MsgGroupType;
}

function formatGroupTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return `Yesterday ${format(date, "h:mm a")}`;
  return format(date, "MMM d, h:mm a");
}

export function MessageGroup({ group }: MessageGroupProps) {
  const isSent = group.direction === "sent";

  return (
    <div className={cn("msg-group", isSent ? "msg-group--sent" : "msg-group--received")}>
      <span className="msg-group__time">
        {formatGroupTime(group.timestamp)}
      </span>

      {group.messages.map((msg, i) => (
        <motion.div
          key={msg.msg_id}
          variants={messagePopIn}
          initial="hidden"
          animate="visible"
          transition={{ delay: i * 0.03 }}
          className="w-full"
        >
          <MessageBubble
            message={msg}
            isFirst={i === 0}
            isLast={i === group.messages.length - 1}
          />
        </motion.div>
      ))}
    </div>
  );
}
