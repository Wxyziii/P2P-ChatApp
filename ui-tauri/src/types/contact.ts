export interface Contact {
  username: string;
  public_key: string;
  signing_key: string;
  online: boolean;
  last_seen: string;
  last_ip: string;
  added_at: string;
}

export interface ContactWithPreview extends Contact {
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
}
