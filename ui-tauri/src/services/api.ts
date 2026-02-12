import { API_BASE_URL, MESSAGE_PAGE_SIZE } from "@/lib/constants";
import type { Contact } from "@/types/contact";
import type { StatusResponse, MessagesResponse } from "@/types/api";

class ApiService {
  private baseUrl: string;

  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ── Status ──────────────────────────────────────────────────
  async getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/status");
  }

  // ── Friends ─────────────────────────────────────────────────
  async listFriends(): Promise<Contact[]> {
    return this.request<Contact[]>("/friends");
  }

  async addFriend(username: string): Promise<Contact> {
    return this.request<Contact>("/friends", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
  }

  async removeFriend(username: string): Promise<void> {
    return this.request<void>(`/friends/${encodeURIComponent(username)}`, {
      method: "DELETE",
    });
  }

  // ── Messages ────────────────────────────────────────────────
  async getMessages(
    peer: string,
    limit = MESSAGE_PAGE_SIZE,
    offset = 0
  ): Promise<MessagesResponse> {
    const params = new URLSearchParams({
      peer,
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<MessagesResponse>(`/messages?${params}`);
  }

  async sendMessage(
    to: string,
    text: string
  ): Promise<{ msg_id: string; delivered: boolean; delivery_method: string }> {
    return this.request("/messages", {
      method: "POST",
      body: JSON.stringify({ to, text }),
    });
  }

  async deleteMessage(msgId: string): Promise<void> {
    return this.request<void>(`/messages/${encodeURIComponent(msgId)}`, {
      method: "DELETE",
    });
  }
}

export const api = new ApiService();
