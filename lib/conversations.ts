import type { AskSource, CitationSegment } from "@/lib/api";

export type ToolEvent = {
  id: string;
  name: string;
  phase: "call" | "result";
  detail: string;
};

// A conversation is a tree, not a flat log: editing a past question or
// regenerating a past answer creates a new sibling under the same parent
// instead of overwriting anything, so both stay reachable. `id` mirrors
// the backend's message id once a turn completes (a temporary local id
// while it's still in flight - see Chat.tsx's runAsk). `parentId` is null
// for a message at the conversation's root.
export type ChatMessage = {
  id: string;
  parentId: string | null;
  role: "user" | "assistant" | "error";
  content: string;
  thinking?: string;
  sources?: AskSource[];
  citations?: CitationSegment[];
  toolEvents?: ToolEvent[];
  createdAt: number;
};

export type StoredConversation = {
  id: string;
  title: string;
  updatedAt: number;
  conversationId?: string;
  // Every message ever created in this conversation, keyed by id - not
  // just the currently active branch. `activeLeafId` (null for an empty
  // conversation) is the tip of the path currently shown; walk `parentId`
  // from there to the root to render the transcript (see getActivePath).
  nodes: Record<string, ChatMessage>;
  activeLeafId: string | null;
};

// Pre-branching conversations were stored as a flat `messages` array with
// no `parentId`. Loaded once and converted into a straight-line tree
// (each message's parent is the one before it) so old conversations keep
// rendering and resending correctly instead of silently vanishing after
// this schema change.
type LegacyStoredConversation = {
  id: string;
  title: string;
  updatedAt: number;
  conversationId?: string;
  messages: Omit<ChatMessage, "parentId">[];
};

function isLegacy(
  raw: StoredConversation | LegacyStoredConversation
): raw is LegacyStoredConversation {
  return Array.isArray((raw as LegacyStoredConversation).messages);
}

function migrate(raw: StoredConversation | LegacyStoredConversation): StoredConversation {
  if (!isLegacy(raw)) return raw;
  const nodes: Record<string, ChatMessage> = {};
  let parentId: string | null = null;
  for (const m of raw.messages) {
    nodes[m.id] = { ...m, parentId };
    parentId = m.id;
  }
  return {
    id: raw.id,
    title: raw.title,
    updatedAt: raw.updatedAt,
    conversationId: raw.conversationId,
    nodes,
    activeLeafId: parentId,
  };
}

// The currently active transcript: walks `parentId` from `activeLeafId`
// up to the root, oldest first - what actually renders in the chat.
export function getActivePath(conversation: Pick<StoredConversation, "nodes" | "activeLeafId">): ChatMessage[] {
  const path: ChatMessage[] = [];
  let current = conversation.activeLeafId;
  while (current) {
    const node = conversation.nodes[current];
    if (!node) break;
    path.unshift(node);
    current = node.parentId;
  }
  return path;
}

// Other user-turn versions at the same branch point as `messageId`, oldest
// first - the raw material for a "‹ 2/3 ›" sibling switcher. Only user
// messages branch (each has exactly one assistant reply as its child), so
// callers only need this for role: "user" nodes.
export function getSiblings(
  conversation: Pick<StoredConversation, "nodes">,
  messageId: string
): ChatMessage[] {
  const node = conversation.nodes[messageId];
  if (!node) return [];
  return Object.values(conversation.nodes)
    .filter((m) => m.role === "user" && m.parentId === node.parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Resumes a branch where it was left off: walks down from `messageId`
// through whichever child was created most recently at each step, until a
// leaf is reached.
export function getLatestDescendantLeaf(
  conversation: Pick<StoredConversation, "nodes">,
  messageId: string
): string {
  let current = messageId;
  for (;;) {
    const children = Object.values(conversation.nodes).filter((m) => m.parentId === current);
    if (children.length === 0) return current;
    children.sort((a, b) => b.createdAt - a.createdAt);
    current = children[0].id;
  }
}

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
    return Array.isArray(parsed) ? parsed.map(migrate) : [];
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
