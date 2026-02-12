import { motion } from "framer-motion";
import { Search, UserPlus } from "lucide-react";
import { ContactList } from "@/components/contacts/ContactList";
import { AddFriendDialog } from "@/components/contacts/AddFriendDialog";
import { useContacts } from "@/hooks/useContacts";
import { useUIStore } from "@/stores/uiStore";
import { buttonPress } from "@/lib/animations";

export function Sidebar() {
  const { searchQuery, setSearchQuery } = useContacts();
  const showDialog = useUIStore((s) => s.showAddFriendDialog);
  const setShowDialog = useUIStore((s) => s.setShowAddFriendDialog);

  return (
    <>
      <div className="sidebar__header">
        <h2 className="sidebar__title">Messages</h2>
        <motion.button
          onClick={() => setShowDialog(true)}
          className="icon-btn icon-btn--accent"
          title="Add Friend"
          {...buttonPress}
        >
          <UserPlus size={14} strokeWidth={2.5} />
        </motion.button>
      </div>

      <div className="sidebar__search">
        <div className="search-wrap">
          <Search size={15} className="search-wrap__icon" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input input--search"
          />
        </div>
      </div>

      <div className="sidebar__contacts">
        <ContactList />
      </div>

      {showDialog && <AddFriendDialog onClose={() => setShowDialog(false)} />}
    </>
  );
}
