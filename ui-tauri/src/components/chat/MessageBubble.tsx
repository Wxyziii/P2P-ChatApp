import { useState } from "react";
import { motion } from "framer-motion";
import { Check, CheckCheck, Cloud, Zap } from "lucide-react";
import { ReactionBar } from "@/components/emoji/ReactionBar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { Message } from "@/types/message";

interface MessageBubbleProps {
  message: Message;
  isFirst: boolean;
  isLast: boolean;
}

export function MessageBubble({ message, isFirst, isLast }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const isSent = message.direction === "sent";
  const time = format(new Date(message.timestamp), "h:mm a");

  const positionClass = isFirst && isLast
    ? "bubble--solo"
    : isFirst
      ? "bubble--first"
      : isLast
        ? "bubble--last"
        : "bubble--middle";

  return (
    <div
      className={cn("flex w-full", isSent ? "justify-end" : "justify-start")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "bubble",
          isSent ? "bubble--sent" : "bubble--received",
          positionClass,
        )}
      >
        <p className="bubble__text">{message.text}</p>

        <div className="bubble__meta">
          <span className="bubble__time">{time}</span>
          {isSent && (
            <span className="bubble__delivery">
              {message.delivery_method === "offline" ? (
                <Cloud size={10} className="bubble__delivery-icon" />
              ) : (
                <Zap size={9} className="bubble__delivery-icon--delivered" style={{ opacity: 0.7 }} />
              )}
              {message.delivered ? (
                <CheckCheck size={13} className="bubble__delivery-icon--delivered" />
              ) : (
                <Check size={13} className="bubble__delivery-icon" />
              )}
            </span>
          )}
        </div>

        {message.reactions && message.reactions.length > 0 && (
          <div className="bubble__reactions">
            {message.reactions.map((r, i) => (
              <span key={i} className="bubble__reaction">{r.emoji}</span>
            ))}
          </div>
        )}

        {/* Hover reaction bar */}
        <motion.div
          initial={false}
          animate={{ opacity: hovered ? 1 : 0, scale: hovered ? 1 : 0.8, y: hovered ? 0 : 4 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "absolute -top-3 z-10",
            isSent ? "right-0" : "left-0"
          )}
          style={{ pointerEvents: hovered ? "auto" : "none" }}
        >
          <ReactionBar messageId={message.msg_id} />
        </motion.div>
      </div>
    </div>
  );
}
