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
// for a message at the conversation's root. The backend is the only
// source of truth for a conversation's messages (GET /conversations/{id})
// - sources/citations/thinking/toolEvents are ephemeral, per-turn UI
// extras that only exist for the turn just streamed in this session, not
// persisted server-side or restored when reopening a past conversation.
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

type ConversationTree = {
  nodes: Record<string, ChatMessage>;
  activeLeafId: string | null;
};

// The currently active transcript: walks `parentId` from `activeLeafId`
// up to the root, oldest first - what actually renders in the chat.
export function getActivePath(conversation: ConversationTree): ChatMessage[] {
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
  conversation: Pick<ConversationTree, "nodes">,
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
  conversation: Pick<ConversationTree, "nodes">,
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

// Fallback label for a conversation whose backend title hasn't been
// generated yet (or failed to generate) - a truncated copy of its first
// question, same as the title the backend itself falls back to.
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
