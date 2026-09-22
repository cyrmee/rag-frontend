import type { AskSource } from "@/lib/api";

export type ToolEvent = {
  id: string;
  name: string;
  phase: "call" | "result";
  detail: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  thinking?: string;
  sources?: AskSource[];
  toolEvents?: ToolEvent[];
  createdAt: number;
};

export type StoredConversation = {
  id: string;
  title: string;
  updatedAt: number;
  conversationId?: string;
  messages: ChatMessage[];
};

const STORAGE_KEY = "anbabi:conversations";
const MAX_CONVERSATIONS = 50;

function isBrowser() {
  return typeof window !== "undefined";
}

export function loadConversations(): StoredConversation[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredConversation[]) : [];
  } catch {
    return [];
  }
}

export function saveConversation(conversation: StoredConversation) {
  if (!isBrowser()) return;
  const rest = loadConversations().filter((c) => c.id !== conversation.id);
  const next = [conversation, ...rest].slice(0, MAX_CONVERSATIONS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or unavailable; the conversation just won't persist
  }
}

export function deleteConversation(id: string) {
  if (!isBrowser()) return;
  const next = loadConversations().filter((c) => c.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function titleFromQuestion(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New conversation";
  return trimmed.length > 64 ? `${trimmed.slice(0, 64)}…` : trimmed;
}

export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
