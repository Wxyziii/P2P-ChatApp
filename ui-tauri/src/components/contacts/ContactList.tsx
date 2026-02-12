import { motion, AnimatePresence } from "framer-motion";
import { ContactItem } from "./ContactItem";
import { useContacts } from "@/hooks/useContacts";
import { useChatStore } from "@/stores/chatStore";
import { useContactStore } from "@/stores/contactStore";
import { listItem } from "@/lib/animations";
import { Users } from "lucide-react";

export function ContactList() {
  const { contacts, loading } = useContacts();
  const activeChat = useChatStore((s) => s.activeChat);
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const clearUnread = useContactStore((s) => s.clearUnread);

  const handleSelect = (username: string) => {
    setActiveChat(username);
    clearUnread(username);
  };

  if (loading && contacts.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-accent/40 animate-float"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 px-6 text-center">
        <div className="p-3 rounded-2xl bg-[var(--color-bg-sunken)]">
          <Users size={22} className="text-[var(--color-text-muted)]" />
        </div>
        <div>
          <p className="text-[13px] font-medium text-[var(--color-text-secondary)]">No contacts yet</p>

          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            Tap <span className="text-accent font-semibold">+</span> to add a friend
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-1">
      <AnimatePresence mode="popLayout">
        {contacts.map((contact, i) => (
          <motion.div
            key={contact.username}
            custom={i}
            variants={listItem}
            initial="hidden"
            animate="visible"
            exit="hidden"
            layout
          >
            <ContactItem
              contact={contact}
              active={activeChat === contact.username}
              onClick={() => handleSelect(contact.username)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
