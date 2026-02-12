import { useEffect } from "react";
import { useContactStore } from "@/stores/contactStore";
import { POLL_INTERVAL_MS } from "@/lib/constants";

export function useContacts() {
  const contacts = useContactStore((s) => s.contacts);
  const loading = useContactStore((s) => s.loading);
  const error = useContactStore((s) => s.error);
  const searchQuery = useContactStore((s) => s.searchQuery);
  const fetchContacts = useContactStore((s) => s.fetchContacts);
  const setSearchQuery = useContactStore((s) => s.setSearchQuery);

  useEffect(() => {
    fetchContacts();
    const interval = setInterval(fetchContacts, POLL_INTERVAL_MS * 5);
    return () => clearInterval(interval);
  }, [fetchContacts]);

  const filtered = searchQuery
    ? contacts.filter((c) =>
        c.username.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : contacts;

  const sorted = [...filtered].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.lastMessageTime && b.lastMessageTime) {
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    }
    return a.username.localeCompare(b.username);
  });

  return { contacts: sorted, loading, error, searchQuery, setSearchQuery };
}
