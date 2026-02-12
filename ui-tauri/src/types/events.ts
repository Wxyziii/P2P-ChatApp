import type { Message } from "./message";

export type WSEvent =
  | { event: "new_message"; data: Message }
  | { event: "friend_online"; data: { username: string } }
  | { event: "friend_offline"; data: { username: string } }
  | { event: "typing"; data: { username: string; typing: boolean } };

export type WSClientEvent =
  | { event: "typing"; data: { to: string; typing: boolean } }
  | { event: "mark_read"; data: { peer: string; msg_id: string } };
