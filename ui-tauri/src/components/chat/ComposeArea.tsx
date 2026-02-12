import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Smile } from "lucide-react";
import { EmojiPicker } from "@/components/emoji/EmojiPicker";
import { websocket } from "@/services/websocket";
import { TYPING_DEBOUNCE_MS } from "@/lib/constants";
import { buttonPress } from "@/lib/animations";
import { cn } from "@/lib/utils";

interface ComposeAreaProps {
  onSend: (text: string) => Promise<void>;
  peer: string;
}

export function ComposeArea({ onSend, peer }: ComposeAreaProps) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [text]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [peer]);

  const handleTyping = useCallback(() => {
    websocket.send({ event: "typing", data: { to: peer, typing: true } });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      websocket.send({ event: "typing", data: { to: peer, typing: false } });
    }, TYPING_DEBOUNCE_MS);
  }, [peer]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setText("");
      websocket.send({ event: "typing", data: { to: peer, typing: false } });
      textareaRef.current?.focus();
    } catch {
      // Error handled by store
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setText((prev) => prev + emoji);
    setShowEmoji(false);
    textareaRef.current?.focus();
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="chat-panel__compose relative">
      {/* Emoji picker overlay */}
      <AnimatePresence>
        {showEmoji && (
          <motion.div
            className="absolute bottom-full right-4 mb-2 z-50"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="compose">
        {/* Emoji toggle */}
        <button
          onClick={() => setShowEmoji(!showEmoji)}
          className={cn(
            "icon-btn",
            showEmoji && "icon-btn--accent"
          )}
        >
          <Smile size={18} />
        </button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleTyping();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="compose__textarea"
        />

        {/* Send button */}
        <motion.button
          onClick={handleSend}
          disabled={!hasText || sending}
          className={cn(
            "compose__send",
            hasText ? "compose__send--active" : "compose__send--inactive"
          )}
          {...(hasText ? buttonPress : {})}
        >
          <Send size={16} className={cn(hasText && "-rotate-12 transition-transform")} />
        </motion.button>
      </div>
    </div>
  );
}
