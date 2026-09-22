"use client";

import { useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  deleteConversationApi,
  getConversation,
  listConversations,
  streamAsk,
  uploadDocumentWithProgress,
  type AskSource,
  type CitationSegment,
  type ConversationSummary,
} from "@/lib/api";
import {
  getActivePath,
  getLatestDescendantLeaf,
  getSiblings,
  titleFromQuestion,
  type ChatMessage,
} from "@/lib/conversations";
import DocumentPanel, { ACCEPTED_TYPES } from "@/app/components/DocumentPanel";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  GlobeIcon,
  MenuIcon,
  MicIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  ReplyIcon,
  RotateCcwIcon,
  SquareIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";

// Citation links (and any other link the model's markdown happens to
// produce) open in a new tab rather than navigating away from the chat.
const markdownComponents = {
  a: ({ href, title, children }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} title={title} target="_blank" rel="noreferrer noopener" className="chat-citation-link">
      {children}
    </a>
  ),
};

// Minimal shape of the Web Speech API's SpeechRecognition — not in TS's
// DOM lib, and only the handful of members this component actually uses.
type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
type SpeechRecognitionLike = {
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function formatArgs(args: unknown): string {
  if (args == null) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

// `citations` (from the done event) is the structured breakdown — each
// segment's [N] markers are already stripped, replaced by source_indices
// (1-based into `sources`). Rebuilds one markdown string: each segment's
// text gets a real markdown link appended per citation index (title =
// filename, for a hover tooltip; an index with no matching source, or a
// source with no document_url, falls back to plain "[N]" text rather than
// a dead link), then every segment is rejoined with "\n" — an empty
// segment (a paragraph break marker) naturally reconstructs the original
// blank line this way, so paragraphs/lists come back exactly as the model
// wrote them. Only feed this to ReactMarkdown as one combined string, not
// one call per segment — a lone "* item" line rendered in isolation loses
// its sibling list items.
function buildCitedMarkdown(citations: CitationSegment[], sources: AskSource[] | undefined): string {
  return citations
    .map((segment) => {
      if (segment.source_indices.length === 0) return segment.text;
      const links = segment.source_indices
        .map((idx) => {
          const source = sources?.[idx - 1];
          if (!source?.document_url) return `[${idx}]`;
          const title = (source.filename ?? "").replace(/"/g, "'");
          return `[[${idx}]](${source.document_url} "${title}")`;
        })
        .join("");
      return `${segment.text} ${links}`;
    })
    .join("\n");
}

// page_number means something different per format: a real page (pdf), a
// slide (pptx), a sheet order index (xlsx), or a synthetic paragraph/table
// index (docx, which has no true page concept) — null for txt/md.
function formatUnit(sourceFormat: string | undefined, pageNumber: number | null | undefined): string {
  if (pageNumber == null) return "";
  switch (sourceFormat) {
    case "pdf":
      return ` · page ${pageNumber}`;
    case "pptx":
      return ` · slide ${pageNumber}`;
    case "xlsx":
      return ` · sheet ${pageNumber}`;
    case "docx":
      return ` · part ${pageNumber}`;
    default:
      return ` · ${pageNumber}`;
  }
}

export default function Chat() {
  // The conversation tree: every message ever created (not just the
  // active branch) plus which leaf is currently shown. `messages` below
  // derives the rendered transcript by walking parentId from activeLeafId.
  const [nodes, setNodes] = useState<Record<string, ChatMessage>>({});
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  // The backend conversation this session is attached to - undefined until
  // the first turn completes (see runAsk's onDone). Doubles as the active
  // conversation's identity for the sidebar/history, replacing the old
  // localStorage-only session id: a conversation isn't "real" (or listed)
  // until the backend has actually persisted a turn for it.
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  // Only set once, right after a brand-new conversation's first turn
  // completes (see runAsk's onDone) - overrides the client-side
  // titleFromQuestion() guess with the backend's generated title.
  const [serverTitle, setServerTitle] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [selectionMenu, setSelectionMenu] = useState<{ text: string; top: number; left: number } | null>(
    null
  );
  const [listening, setListening] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  // Web Speech API has no official TS lib typing; SpeechRecognition here is
  // whatever constructor the browser exposes (vendor-prefixed on Chromium).
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const messages = useMemo(
    () => getActivePath({ nodes, activeLeafId }),
    [nodes, activeLeafId]
  );

  // The sidebar's conversation list is fetched from the backend, not
  // cached locally - it's the source of truth for what conversations
  // exist and what they're titled, and survives clearing browser storage
  // or switching devices. Best-effort: a failed fetch just leaves the
  // sidebar showing whatever it last had rather than surfacing an error.
  async function refreshHistory() {
    try {
      setHistory(await listConversations());
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshHistory();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.stop();
    };
  }, []);

  // "/" focuses the composer from anywhere on the page, as long as the user
  // isn't already typing into some other field.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      textareaRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Selecting text inside the transcript surfaces a floating "Reply" button
  // near the selection, so quoting part of an earlier message into a
  // follow-up doesn't require manually copying and retyping it.
  useEffect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setSelectionMenu(null);
        return;
      }
      const anchorNode = sel.anchorNode;
      if (!anchorNode || !transcriptRef.current?.contains(anchorNode)) {
        setSelectionMenu(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelectionMenu(null);
        return;
      }
      setSelectionMenu({
        text: sel.toString(),
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  // Shared by a normal send, an edited question, and a regenerated answer.
  // `parentId` is the tree node the new user turn attaches under - null
  // for the conversation root (its first message), an existing node's id
  // to branch from there. A normal send passes the current activeLeafId
  // (or null for a brand-new conversation); editing/regenerating passes
  // the edited/regenerated message's own parentId, so the new turn becomes
  // a sibling of what's already there instead of replacing it.
  async function runAsk(question: string, parentId: string | null) {
    if (!question || pending) return;

    const tempUserId = makeId();
    const tempAssistantId = makeId();
    const now = Date.now();
    setNodes((prev) => ({
      ...prev,
      [tempUserId]: { id: tempUserId, parentId, role: "user", content: question, createdAt: now },
      [tempAssistantId]: {
        id: tempAssistantId,
        parentId: tempUserId,
        role: "assistant",
        content: "",
        toolEvents: [],
        createdAt: now,
      },
    }));
    setActiveLeafId(tempAssistantId);
    setPending(true);

    function updateAssistant(patch: (message: ChatMessage) => ChatMessage) {
      setNodes((prev) => {
        const existing = prev[tempAssistantId];
        if (!existing) return prev;
        return { ...prev, [tempAssistantId]: patch(existing) };
      });
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAsk(
        question,
        { conversationId, parentMessageId: parentId ?? "", webSearch: webSearchEnabled },
        {
          onThinking: (token) => {
            updateAssistant((m) => ({
              ...m,
              thinking: (m.thinking ?? "") + token,
            }));
          },
          onAnswer: (token) => {
            updateAssistant((m) => ({ ...m, content: m.content + token }));
          },
          onToolCall: (name, args) => {
            updateAssistant((m) => ({
              ...m,
              toolEvents: [
                ...(m.toolEvents ?? []),
                { id: makeId(), name, phase: "call", detail: formatArgs(args) },
              ],
            }));
          },
          onToolResult: (name, preview) => {
            updateAssistant((m) => ({
              ...m,
              toolEvents: [
                ...(m.toolEvents ?? []),
                { id: makeId(), name, phase: "result", detail: preview },
              ],
            }));
          },
          onDone: (sources, nextConversationId, citations, userMessageId, assistantMessageId, title) => {
            // Rekey the temporary local ids to the backend's real message
            // ids, so a later edit/regenerate/branch-switch can reference
            // this turn correctly.
            setNodes((prev) => {
              const next = { ...prev };
              const userNode = next[tempUserId];
              const assistantNode = next[tempAssistantId];
              delete next[tempUserId];
              delete next[tempAssistantId];
              if (userNode && userMessageId) {
                next[userMessageId] = { ...userNode, id: userMessageId };
              }
              if (assistantNode && assistantMessageId) {
                next[assistantMessageId] = {
                  ...assistantNode,
                  id: assistantMessageId,
                  parentId: userMessageId ?? assistantNode.parentId,
                  sources,
                  citations,
                };
              }
              return next;
            });
            if (assistantMessageId) setActiveLeafId(assistantMessageId);
            if (nextConversationId) setConversationId(nextConversationId);
            if (title) setServerTitle(title);
            // Refresh so the sidebar picks up this turn's new/updated
            // title and recency without waiting for the next mount.
            refreshHistory();
          },
          onError: (message) => {
            updateAssistant((m) => ({ ...m, role: "error", content: message }));
          },
        },
        controller.signal
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        updateAssistant((m) => ({
          ...m,
          role: "error",
          content: err instanceof Error ? err.message : "The request failed.",
        }));
      }
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;
    setInput("");
    await runAsk(question, activeLeafId);
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  // Plays the exit animation on the deleted node and everything under it
  // (its reply, and anything that continued from there - a node can have
  // more than one child once branching is in play), then actually drops
  // them from state once the animation finishes instead of vanishing
  // instantly.
  function handleDeletePair(userMessageId: string) {
    const deletedNode = nodes[userMessageId];
    if (!deletedNode) return;
    const toDelete = new Set<string>();
    const stack = [userMessageId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (toDelete.has(id)) continue;
      toDelete.add(id);
      for (const m of Object.values(nodes)) {
        if (m.parentId === id) stack.push(m.id);
      }
    }

    setRemovingIds((prev) => new Set([...prev, ...toDelete]));
    setTimeout(() => {
      setNodes((prev) => {
        const next = { ...prev };
        for (const id of toDelete) delete next[id];
        return next;
      });
      setRemovingIds((prev) => {
        const next = new Set(prev);
        toDelete.forEach((id) => next.delete(id));
        return next;
      });
      if (activeLeafId && toDelete.has(activeLeafId)) {
        setActiveLeafId(deletedNode.parentId);
      }
    }, 180);
  }

  function handleStartEdit(id: string, content: string) {
    abortRef.current?.abort();
    setPending(false);
    setEditingId(id);
    setEditValue(content);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function handleSubmitEdit(id: string) {
    const question = editValue.trim();
    if (!question) return;
    const node = nodes[id];
    if (!node) return;
    setEditingId(null);
    setEditValue("");
    await runAsk(question, node.parentId);
  }

  function handleNewConversation() {
    abortRef.current?.abort();
    setNodes({});
    setActiveLeafId(null);
    setConversationId(undefined);
    setServerTitle(undefined);
    setPending(false);
    setMobileNavOpen(false);
  }

  async function handleSelectConversation(id: string) {
    abortRef.current?.abort();
    setPending(false);
    setMobileNavOpen(false);
    try {
      const detail = await getConversation(id);
      const nextNodes: Record<string, ChatMessage> = {};
      for (const m of detail.messages) {
        nextNodes[m.id] = {
          id: m.id,
          parentId: m.parent_message_id,
          role: m.role as ChatMessage["role"],
          content: m.content,
          createdAt: Date.parse(m.created_at),
        };
      }
      setNodes(nextNodes);
      setActiveLeafId(detail.active_message_id);
      setConversationId(detail.id);
      setServerTitle(detail.title ?? undefined);
    } catch (err) {
      toast.add({
        title: "Couldn't open that conversation",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
      // It may have been deleted elsewhere - drop it from the visible list.
      refreshHistory();
    }
  }

  async function handleDeleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const wasActive = id === conversationId;
    setHistory((prev) => prev.filter((c) => c.id !== id));
    if (wasActive) {
      setNodes({});
      setActiveLeafId(null);
      setConversationId(undefined);
      setServerTitle(undefined);
    }
    try {
      await deleteConversationApi(id);
    } catch (err) {
      toast.add({
        title: "Couldn't delete conversation",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
      refreshHistory();
    }
  }

  async function handleCopy(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      toast.add({ title: "Copied to clipboard", type: "success" });
    } catch {
      toast.add({ title: "Couldn't copy", type: "error" });
    }
  }

  // Regenerating re-asks the same question that produced this answer, as
  // a new sibling branch under the same parent - the old answer stays
  // reachable via the branch switcher rather than being overwritten.
  async function handleRegenerate(assistantId: string) {
    if (pending) return;
    const assistantNode = nodes[assistantId];
    const userNode = assistantNode?.parentId ? nodes[assistantNode.parentId] : undefined;
    if (!userNode) return;
    await runAsk(userNode.content, userNode.parentId);
  }

  function handleSwitchBranch(siblingId: string) {
    if (pending) return;
    setActiveLeafId(getLatestDescendantLeaf({ nodes }, siblingId));
  }

  function handleReplyToSelection() {
    if (!selectionMenu) return;
    const quote = selectionMenu.text
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setInput((prev) => (prev ? `${quote}\n\n${prev}` : `${quote}\n\n`));
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
    textareaRef.current?.focus();
  }

  function toggleVoiceInput() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      toast.add({ title: "Voice input isn't supported in this browser", type: "error" });
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function handleAttachFiles(files: FileList) {
    const list = Array.from(files);
    if (list.length === 0) return;

    let succeeded = 0;
    let firstError: string | null = null;
    for (const file of list) {
      try {
        await uploadDocumentWithProgress(file);
        succeeded += 1;
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : "Upload failed.";
      }
    }
    if (attachInputRef.current) attachInputRef.current.value = "";

    if (succeeded > 0) {
      toast.add({
        title:
          list.length === 1
            ? `${list[0].name} added to Sources`
            : `${succeeded} of ${list.length} files added to Sources`,
        type: "success",
      });
    }
    if (firstError) {
      toast.add({
        title: succeeded > 0 ? "Some files failed to upload" : "Upload failed",
        description: firstError,
        type: "error",
      });
    }
  }

  const composer = (
    <form onSubmit={handleSubmit} className="w-full">
      <InputGroup
        className="rounded-3xl border border-border bg-card p-1 shadow-sm transition-colors focus-within:border-signal-gold/60 hover:border-foreground/20"
        style={{ "--ring": "var(--color-signal-gold)" } as React.CSSProperties}
      >
        <InputGroupTextarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Ask a question…"
          aria-label="Question"
          rows={1}
          className="max-h-40 min-h-10 px-3.5 pt-2.5 text-[15px]"
          disabled={pending}
        />
        <InputGroupAddon align="block-end" className="justify-between px-1.5 pb-1.5">
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<InputGroupButton variant="ghost" size="icon-sm" aria-label="Add files" />}
              >
                <PlusIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => attachInputRef.current?.click()}>
                    <PaperclipIcon data-icon="inline-start" />
                    Add files
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              type="button"
              variant={webSearchEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setWebSearchEnabled((v) => !v)}
              aria-pressed={webSearchEnabled}
              className="gap-1.5 rounded-full"
            >
              <GlobeIcon data-icon="inline-start" />
              <span className="hidden sm:inline">Search the web</span>
            </InputGroupButton>
          </div>
          <input
            ref={attachInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) handleAttachFiles(e.target.files);
            }}
          />

          <div className="flex items-center gap-1">
            <InputGroupButton
              type="button"
              variant={listening ? "default" : "ghost"}
              size="icon-sm"
              onClick={toggleVoiceInput}
              aria-label={listening ? "Stop voice input" : "Voice input"}
              title={listening ? "Stop voice input" : "Voice input"}
            >
              <MicIcon className={listening ? "animate-pulse" : undefined} />
            </InputGroupButton>
            {pending ? (
              <InputGroupButton
                type="button"
                variant="destructive"
                size="icon-sm"
                onClick={handleStop}
                aria-label="Stop generating"
              >
                <SquareIcon className="animate-in zoom-in-50 duration-150" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={!input.trim()}
                aria-label="Send"
              >
                <ArrowUpIcon className="animate-in zoom-in-50 duration-150" />
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {selectionMenu && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full animate-in fade-in zoom-in-95 pb-2 duration-100"
          style={{ top: selectionMenu.top, left: selectionMenu.left }}
        >
          <Button
            variant="default"
            size="sm"
            className="rounded-full shadow-md"
            onClick={handleReplyToSelection}
          >
            <ReplyIcon data-icon="inline-start" />
            Reply
          </Button>
        </div>
      )}

      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border lg:flex">
        <SidebarContent
          history={history}
          activeConversationId={conversationId}
          sourcesActive={docsOpen}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onOpenSources={() => setDocsOpen(true)}
        />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-72 gap-0 border-sidebar-border p-0 [&_[data-slot=sheet-close]]:text-white [&_[data-slot=sheet-close]]:hover:bg-white/15"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <SidebarContent
            history={history}
            activeConversationId={conversationId}
            sourcesActive={docsOpen}
            onNewConversation={handleNewConversation}
            onSelectConversation={handleSelectConversation}
            onDeleteConversation={handleDeleteConversation}
            onOpenSources={() => {
              setMobileNavOpen(false);
              setDocsOpen(true);
            }}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {docsOpen ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDocsOpen(false)}
                aria-label="Back to chat"
              >
                <ArrowLeftIcon />
              </Button>
              <span className="text-sm font-semibold tracking-tight text-foreground lg:hidden">
                Sources
              </span>
            </div>
            <div className="min-h-0 flex-1 animate-in fade-in overflow-y-auto duration-200">
              <DocumentPanel />
            </div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 lg:hidden">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open menu"
                >
                  <MenuIcon />
                </Button>
                <span className="text-sm font-semibold tracking-tight text-foreground">
                  Fayda አንባቢ
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleNewConversation}
                disabled={messages.length === 0}
                aria-label="New chat"
              >
                <SquarePenIcon />
              </Button>
            </div>

            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-40">
                <Empty className="border-none p-0">
                  <EmptyTitle className="text-2xl font-semibold">
                    What should አንባቢ read for you?
                  </EmptyTitle>
                </Empty>
                <div className="w-full max-w-2xl">{composer}</div>
              </div>
            ) : (
              <>
                <MessageScrollerProvider>
                  <MessageScroller className="min-h-0 flex-1 animate-in fade-in duration-300">
                    <MessageScrollerViewport onScroll={() => setSelectionMenu(null)}>
                      <MessageScrollerContent
                        ref={transcriptRef}
                        className="mx-auto w-full max-w-2xl px-4 py-6"
                      >
                        {messages.map((message) => (
                          <MessageScrollerItem
                            key={message.id}
                            messageId={message.id}
                            scrollAnchor={message.role === "user"}
                            className={
                              removingIds.has(message.id)
                                ? "animate-out fade-out slide-out-to-top-1 duration-180 fill-mode-forwards ease-in"
                                : "animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out fill-mode-both"
                            }
                          >
                            <ChatMessageRow
                              message={message}
                              pending={pending}
                              onCopy={handleCopy}
                              onRegenerate={handleRegenerate}
                              isEditing={editingId === message.id}
                              editValue={editValue}
                              onEditValueChange={setEditValue}
                              onStartEdit={handleStartEdit}
                              onCancelEdit={handleCancelEdit}
                              onSubmitEdit={handleSubmitEdit}
                              onDelete={handleDeletePair}
                              siblings={message.role === "user" ? getSiblings({ nodes }, message.id) : []}
                              onSwitchBranch={handleSwitchBranch}
                            />
                          </MessageScrollerItem>
                        ))}
                      </MessageScrollerContent>
                    </MessageScrollerViewport>
                    <MessageScrollerButton />
                  </MessageScroller>
                </MessageScrollerProvider>
                <div className="shrink-0 animate-in fade-in px-4 pt-2 pb-6 duration-300">
                  <div className="mx-auto w-full max-w-2xl">{composer}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SidebarContent({
  history,
  activeConversationId,
  sourcesActive,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onOpenSources,
}: {
  history: ConversationSummary[];
  activeConversationId: string | undefined;
  sourcesActive: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  onOpenSources: () => void;
}) {
  return (
    <div className="bg-sidebar-gradient flex h-full w-full flex-col p-2 text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <Image
          src="/fayda-logo.png"
          alt=""
          aria-hidden="true"
          width={22}
          height={22}
          className="rounded-full"
        />
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-white">
          Fayda አንባቢ
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-signal-gold"
          />
        </span>
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        <SidebarItem icon={SquarePenIcon} label="New chat" onClick={onNewConversation} />
        <SidebarItem
          icon={FolderOpenIcon}
          label="Sources"
          onClick={onOpenSources}
          active={sourcesActive}
        />
      </div>

      <div className="sidebar-scroll mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <p className="px-3 pb-1.5 text-xs font-medium text-sidebar-foreground/55">
          Recent
        </p>
        {history.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-sidebar-foreground/55">
            Nothing here yet.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {history.map((conv) => {
              const label = conv.title ?? titleFromQuestion(conv.first_question ?? "");
              return (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectConversation(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectConversation(conv.id);
                    }
                  }}
                  className="group/history-row flex cursor-pointer items-center justify-between gap-2 rounded-full px-3 py-2 text-left text-sm transition-[background-color,transform] duration-150 hover:bg-sidebar-accent active:scale-[0.98] data-[active=true]:bg-[oklch(from_var(--color-signal-gold)_l_c_h_/_0.2)]"
                  data-active={conv.id === activeConversationId}
                >
                  <span className="min-w-0 flex-1 truncate text-white">
                    {label}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-sidebar-foreground opacity-0 hover:bg-white/15 hover:text-white group-hover/history-row:opacity-100"
                    onClick={(e) => onDeleteConversation(conv.id, e)}
                    aria-label={`Delete ${label}`}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className="flex items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm font-medium text-white transition-[background-color,transform] duration-150 hover:bg-sidebar-accent active:scale-[0.98] data-[active=true]:bg-[oklch(from_var(--color-signal-gold)_l_c_h_/_0.2)]"
    >
      <Icon className="size-4 shrink-0 text-sidebar-foreground/70" />
      {label}
    </button>
  );
}

function CopyButton({
  content,
  onCopy,
  label,
}: {
  content: string;
  onCopy: (content: string) => void;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => {
        onCopy(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={label}
      title={label}
    >
      {copied ? (
        <CheckIcon key="check" className="animate-in zoom-in-50 duration-150" />
      ) : (
        <CopyIcon key="copy" className="animate-in zoom-in-50 duration-150" />
      )}
    </Button>
  );
}

// "‹ 2/3 ›" control for cycling between alternate versions of a question
// (an edit, or the question a regenerated answer re-asked) at the same
// branch point. Hidden entirely when there's nothing to switch between.
function BranchSwitcher({
  siblings,
  activeId,
  pending,
  onSwitch,
}: {
  siblings: ChatMessage[];
  activeId: string;
  pending: boolean;
  onSwitch: (id: string) => void;
}) {
  if (siblings.length < 2) return null;
  const index = siblings.findIndex((s) => s.id === activeId);
  const current = index === -1 ? 0 : index;
  return (
    <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onSwitch(siblings[Math.max(current - 1, 0)].id)}
        disabled={pending || current === 0}
        aria-label="Previous version"
      >
        <ChevronLeftIcon />
      </Button>
      <span className="tabular-nums">
        {current + 1}/{siblings.length}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={pending || current === siblings.length - 1}
        onClick={() => onSwitch(siblings[Math.min(current + 1, siblings.length - 1)].id)}
        aria-label="Next version"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

function ChatMessageRow({
  message,
  pending,
  onCopy,
  onRegenerate,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  siblings,
  onSwitchBranch,
}: {
  message: ChatMessage;
  pending: boolean;
  onCopy: (content: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: (id: string, content: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string) => void;
  onDelete: (id: string) => void;
  siblings: ChatMessage[];
  onSwitchBranch: (siblingId: string) => void;
}) {
  // Captured once at mount so a later change in `pending` (this message
  // finishing its stream) doesn't fight the Collapsible's own open state.
  const [toolsDefaultOpen] = useState(pending);

  if (message.role === "user") {
    if (isEditing) {
      return (
        <Message align="end">
          <MessageContent>
            <div className="w-full max-w-[80%] self-end">
              <Textarea
                autoFocus
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSubmitEdit(message.id);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onCancelEdit();
                  }
                }}
                className="min-h-16 resize-none rounded-2xl text-sm shadow-none focus-visible:ring-0"
                style={{ "--ring": "var(--color-signal-gold)" } as React.CSSProperties}
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <Button variant="ghost" size="xs" onClick={onCancelEdit}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="xs"
                  onClick={() => onSubmitEdit(message.id)}
                  disabled={!editValue.trim()}
                >
                  Send
                </Button>
              </div>
            </div>
          </MessageContent>
        </Message>
      );
    }

    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="secondary">
            <BubbleContent className="whitespace-pre-wrap">
              {message.content}
            </BubbleContent>
          </Bubble>
          <MessageFooter className="justify-end gap-1">
            <BranchSwitcher siblings={siblings} activeId={message.id} pending={pending} onSwitch={onSwitchBranch} />
            <div className="flex translate-y-0.5 gap-0.5 opacity-0 transition-[opacity,transform] duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover/message:translate-y-0 group-hover/message:opacity-100">
              <CopyButton content={message.content} onCopy={onCopy} label="Copy question" />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onStartEdit(message.id, message.content)}
                aria-label="Edit question"
                title="Edit question"
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onDelete(message.id)}
                aria-label="Delete question"
                title="Delete question"
              >
                <Trash2Icon />
              </Button>
            </div>
          </MessageFooter>
        </MessageContent>
      </Message>
    );
  }

  if (message.role === "error") {
    return (
      <Message>
        <MessageContent>
          <Bubble variant="destructive" role="alert">
            <BubbleContent>{message.content}</BubbleContent>
          </Bubble>
          {!pending && (
            <MessageFooter>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRegenerate(message.id)}
                aria-label="Try again"
                title="Try again"
              >
                <RotateCcwIcon />
              </Button>
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    );
  }

  const isStreaming = pending && !message.content;

  return (
    <Message>
      <MessageContent>
        {message.toolEvents && message.toolEvents.length > 0 && (
          <Collapsible defaultOpen={toolsDefaultOpen}>
            <CollapsibleTrigger className="group/trigger flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronDownIcon className="size-3.5 transition-transform group-aria-expanded/trigger:rotate-180" />
              Lookups ({message.toolEvents.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 flex flex-col gap-1">
              {message.toolEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-baseline gap-2 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
                >
                  <span className="shrink-0 text-muted-foreground">
                    {ev.phase === "call" ? "→" : "←"}
                  </span>
                  <span className="shrink-0 font-medium">{ev.name}</span>
                  {ev.detail && (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {ev.detail}
                    </span>
                  )}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {message.thinking && (
          <Collapsible>
            <CollapsibleTrigger className="group/trigger flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronDownIcon className="size-3.5 transition-transform group-aria-expanded/trigger:rotate-180" />
              Reasoning
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-2 text-xs whitespace-pre-wrap text-muted-foreground">
              {message.thinking}
            </CollapsibleContent>
          </Collapsible>
        )}

        {isStreaming ? (
          <Marker role="status">
            <MarkerContent className="shimmer font-medium">Thinking…</MarkerContent>
          </Marker>
        ) : (
          <Bubble variant="ghost">
            <BubbleContent>
              <div className="chat-markdown">
                {message.citations && message.citations.length > 0 ? (
                  // Answer is complete: render the clean, structured
                  // citation breakdown rather than the raw streamed text
                  // (which may still contain literal "[N]" markers as the
                  // model generated them).
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {buildCitedMarkdown(message.citations, message.sources)}
                  </ReactMarkdown>
                ) : (
                  // Still streaming, or the answer had no citations —
                  // render the raw text as-is.
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {message.content}
                  </ReactMarkdown>
                )}
              </div>
            </BubbleContent>
          </Bubble>
        )}

        {!isStreaming && message.content && (
          <MessageFooter className="translate-y-0.5 opacity-0 transition-[opacity,transform] duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover/message:translate-y-0 group-hover/message:opacity-100">
            <CopyButton content={message.content} onCopy={onCopy} label="Copy answer" />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRegenerate(message.id)}
              disabled={pending}
              aria-label="Regenerate answer"
              title="Regenerate answer"
            >
              <RotateCcwIcon />
            </Button>
          </MessageFooter>
        )}

        {message.sources && message.sources.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group/trigger flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronDownIcon className="size-3.5 transition-transform group-aria-expanded/trigger:rotate-180" />
              Sources ({message.sources.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 flex flex-col gap-1">
              {message.sources.map((source, i) => {
                const label = source.filename ?? source.content ?? "source";
                const page = formatUnit(source.source_format, source.page_number);
                const body = (
                  <>
                    {label}
                    {page}
                  </>
                );
                return (
                  <div key={`${message.id}-${i}`} className="flex items-baseline gap-2 text-xs">
                    <span
                      className="w-4 shrink-0 text-right font-medium"
                      style={{ color: "var(--color-grounded-fg)" }}
                    >
                      {i + 1}
                    </span>
                    {source.document_url ? (
                      <a
                        href={source.document_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {body}
                      </a>
                    ) : (
                      <span className="min-w-0 truncate text-muted-foreground">{body}</span>
                    )}
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}
      </MessageContent>
    </Message>
  );
}
