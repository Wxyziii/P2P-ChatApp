import { motion } from "framer-motion";
import { reactionBounce } from "@/lib/animations";

interface ReactionBarProps {
  messageId: string;
}

const quickReactions = ["👍", "❤️", "😂", "😮", "😢"];

export function ReactionBar({ messageId: _messageId }: ReactionBarProps) {
  const handleReact = (emoji: string) => {
    // TODO: Send reaction to backend when reaction endpoint is implemented
    // api.sendReaction(messageId, emoji);
    console.log("React with", emoji);
  };

  return (
    <motion.div
      className="reaction-bar"
      variants={reactionBounce}
      initial="hidden"
      animate="visible"
    >
      {quickReactions.map((emoji) => (
        <button
          key={emoji}
          onClick={() => handleReact(emoji)}
          className="reaction-bar__btn"
        >
          {emoji}
        </button>
      ))}
    </motion.div>
  );
}
