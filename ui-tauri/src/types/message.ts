export interface Message {
  msg_id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  direction: "sent" | "received";
  delivered: boolean;
  delivery_method: "direct" | "offline";
  reactions?: Reaction[];
}

export interface Reaction {
  emoji: string;
  from: string;
}

export interface MessageGroup {
  sender: string;
  direction: "sent" | "received";
  messages: Message[];
  timestamp: string;
}
