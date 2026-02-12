export interface StatusResponse {
  status: string;
  username: string;
  node_id: string;
  uptime_seconds: number;
  friends_count: number;
  peer_port: number;
  supabase_connected: boolean;
  version: string;
}

export interface MessagesResponse {
  messages: import("./message").Message[];
  total: number;
  has_more: boolean;
}

export interface ApiError {
  error: string;
}
