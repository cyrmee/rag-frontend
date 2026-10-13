"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteConversationApi,
  listConversations,
  renameConversation,
  type ConversationSummary,
} from "@/lib/api";
import { toast } from "@/components/ui/toast";

const PAGE_SIZE = 40;
// How long typing in the sidebar's search pauses before it goes to the server.
const SEARCH_DELAY_MS = 300;

export type ConversationHistory = {
  conversations: ConversationSummary[];
  query: string;
  setQuery: (query: string) => void;
  // True while a search or the first page is loading.
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  // Refetches the first page, e.g. after a turn changes a title or order.
  refresh: () => void;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
};

// The signed-in user's conversations for the sidebar, from the backend:
// a page at a time (GET /conversations is cursor-paged), searchable by
// title or question, with delete and rename applied optimistically and
// rolled back by refetching when the backend refuses.
export function useConversationHistory(): ConversationHistory {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // A newer search or refresh makes an older one's answer stale.
  const latestRequest = useRef(0);

  const loadFirstPage = useCallback(async (term: string) => {
    const request = ++latestRequest.current;
    setLoading(true);
    try {
      const page = await listConversations({ q: term, limit: PAGE_SIZE });
      if (request !== latestRequest.current) return;
      setConversations(page.conversations);
      setNextCursor(page.nextCursor);
    } catch {
      // Best-effort: the sidebar keeps whatever it last showed.
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the externally-owned list for the current search
    loadFirstPage(searchTerm);
  }, [searchTerm, loadFirstPage]);

  useEffect(() => {
    if (query.trim() === searchTerm) return;
    const timer = setTimeout(() => setSearchTerm(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, searchTerm]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const request = latestRequest.current;
    setLoadingMore(true);
    try {
      const page = await listConversations({ q: searchTerm, cursor: nextCursor, limit: PAGE_SIZE });
      if (request !== latestRequest.current) return;
      // A conversation that moved up since the first page can appear on
      // a later one too - keep the first copy.
      setConversations((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.conversations.filter((c) => !seen.has(c.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      toast.add({
        title: "Couldn't load older conversations",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteConversationApi(id);
    } catch (err) {
      toast.add({
        title: "Couldn't delete the conversation",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
      loadFirstPage(searchTerm);
    }
  }

  async function rename(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
    try {
      await renameConversation(id, trimmed);
    } catch (err) {
      toast.add({
        title: "Couldn't rename the conversation",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
      loadFirstPage(searchTerm);
    }
  }

  return {
    conversations,
    query,
    setQuery,
    loading,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    refresh: () => loadFirstPage(searchTerm),
    remove,
    rename,
  };
}
