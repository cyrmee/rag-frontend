"use client";

import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getConversation,
  streamAsk,
  uploadAttachment,
  uploadDocumentWithProgress,
  type AskMode,
  type AskSource,
  type AttachmentInfo,
  type CitationSegment,
} from "@/lib/api";
import {
  getActivePath,
  getLatestDescendantLeaf,
  getSiblings,
  titleFromQuestion,
  type ChatMessage,
} from "@/lib/conversations";
import { ACCEPTED_TYPES } from "@/app/components/DocumentPanel";
import { AnswerChart, ChartSourcesContext } from "@/components/answer-chart";
import { parseChartSpec } from "@/lib/charts";
import { focusSource, parseSourceHref, sourceHref } from "@/lib/source-focus";
import { Sidebar } from "@/app/components/Sidebar";
import { useConversationHistory } from "@/lib/use-conversation-history";
import { ANSWERED_LABELS, MODES, ModePicker, loadStoredMode, storeMode } from "@/app/components/ModePicker";
import { ResearchProgress } from "@/app/components/ResearchProgress";
import { CitationWarnings, NotFound, SourceList, textWarnings } from "@/app/components/AnswerExtras";
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "cn";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleStopIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
  GlobeIcon,
  Loader2Icon,
  MenuIcon,
  MicIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  ReplyIcon,
  RotateCcwIcon,
  SquareIcon,
  SquarePenIcon,
  XIcon,
  Trash2Icon,
} from "lucide-react";

// Citation links (and any other link the model's markdown happens to
// produce) open in a new tab rather than navigating away from the chat.
// A ```chart fenced block (the backend's validated chart spec - see
// lib/charts.ts) renders as a chart instead of a code block: `code`
// swaps the block for AnswerChart, and `pre` drops its own wrapper
// around it so the figure isn't boxed as code. A block that doesn't
// parse stays a plain code block.
type CodeProps = HTMLAttributes<HTMLElement> & { className?: string; children?: ReactNode };

function chartSpecOf(element: unknown) {
  if (!isValidElement<CodeProps>(element)) return null;
  const { className, children } = (element as ReactElement<CodeProps>).props;
  if (typeof className !== "string" || !className.includes("language-chart")) return null;
  return parseChartSpec(String(children ?? ""));
}

const markdownComponents = {
  a: ({ href, title, children }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
    // A citation number opens its source in the list under the answer.
    const target = parseSourceHref(href);
    if (target) {
      return (
        <a
          href={href}
          title={title}
          className="chat-citation-link"
          onClick={(e) => {
            e.preventDefault();
            focusSource(target.messageId, target.index);
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a href={href} title={title} target="_blank" rel="noreferrer noopener" className="chat-citation-link">
        {children}
      </a>
    );
  },
  pre: ({ children, ...props }: HTMLAttributes<HTMLPreElement>) => {
    const only = Array.isArray(children) && children.length === 1 ? children[0] : children;
    if (chartSpecOf(only)) return <>{children}</>;
    return <pre {...props}>{children}</pre>;
  },
  code: ({ className, children, ...props }: CodeProps) => {
    if (className?.includes("language-chart")) {
      const spec = parseChartSpec(String(children ?? ""));
      if (spec) return <AnswerChart spec={spec} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
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
  // Most tools take a search query - show just that rather than JSON.
  const record = args as Record<string, unknown>;
  for (const key of ["query", "question", "filename_contains"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

// The backend's tool names (see its app/generation.py), as what they did.
const TOOL_LABELS: Record<string, { call: string; result: string }> = {
  retrieve: { call: "Searching documents", result: "Found passages" },
  list_documents: { call: "Listing documents", result: "Listed documents" },
  describe_image: { call: "Looking at a figure", result: "Described the figure" },
  web_search: { call: "Searching the web", result: "Found web results" },
  research: { call: "Researching", result: "Collected notes" },
};

function toolLabel(name: string, phase: "call" | "result"): string {
  return TOOL_LABELS[name]?.[phase] ?? name;
}

// `citations` (from the done event, or saved with the answer) is the
// structured breakdown - each segment's [N] markers are already stripped,
// replaced by source_indices (1-based into `sources`). Rebuilds one
// markdown string: each segment's text gets a link per citation index
// that opens that source in the list under the answer (title = filename,
// for a hover tooltip; an index with no matching source falls back to
// plain "[N]" text), then every segment is rejoined with "\n" - an empty
// segment (a paragraph break marker) reconstructs the original blank line
// this way, so paragraphs/lists come back exactly as the model wrote
// them. Only feed this to ReactMarkdown as one combined string, not one
// call per segment - a lone "* item" line rendered in isolation loses its
// sibling list items.
function buildCitedMarkdown(
  citations: CitationSegment[],
  sources: AskSource[] | undefined,
  messageId: string
): string {
  return citations
    .map((segment) => {
      if (segment.source_indices.length === 0) return segment.text;
      const links = segment.source_indices
        .map((idx) => {
          const source = sources?.[idx - 1];
          if (!source) return `[${idx}]`;
          const title = (source.filename ?? "").replace(/"/g, "'");
          return `[[${idx}]](${sourceHref(messageId, idx)} "${title}")`;
        })
        .join("");
      // A no-break space keeps the number on its sentence's last line.
      return `${segment.text}\u00a0${links}`;
    })
    .join("\n");
}

// "[3]"-style markers as the model writes them. Removed from an answer
// that has nothing for them to point at - one saved before answers were
// stored with their sources.
const CITATION_MARKERS = /\s?\[\d+(?:\s*,\s*\d+)*\]/g;

// Answer text for the clipboard: no citation markers or chart specs,
// with the sources the answer cites listed underneath.
function plainAnswer(message: ChatMessage): string {
  const body = (
    message.citations && message.citations.length > 0
      ? message.citations.map((segment) => segment.text).join("\n")
      : message.content.replace(CITATION_MARKERS, "")
  )
    .replace(/```chart[\s\S]*?```\n?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const cited = [...new Set((message.citations ?? []).flatMap((segment) => segment.source_indices))].sort(
    (a, b) => a - b
  );
  const lines = cited
    .map((n) => {
      const source = message.sources?.[n - 1];
      if (!source?.filename) return null;
      const unit = source.page_number != null && source.source_type !== "web" ? `, ${source.page_number}` : "";
      return `[${n}] ${source.filename}${unit}`;
    })
    .filter((line): line is string => line !== null);
  return lines.length > 0 ? `${body}\n\nSources\n${lines.join("\n")}` : body;
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
  const history = useConversationHistory();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [selectionMenu, setSelectionMenu] = useState<{ text: string; top: number; left: number } | null>(
    null
  );
  const [listening, setListening] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  // How the next question is answered (see ModePicker). Children of
  // AuthProvider only mount on the client, after sign-in, so reading
  // storage here can't cause a hydration mismatch.
  const [mode, setMode] = useState<AskMode>(loadStoredMode);
  // Files attached for the *next* message only - cleared once that
  // message is sent. Distinct from "Add files" (attachInputRef below),
  // which ingests into the searchable Sources corpus permanently.
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentInfo[]>([]);
  const [attachingToMessage, setAttachingToMessage] = useState(false);
  // Files on their way into Sources from the composer's "Add to Sources":
  // upload percent, then processing once it reaches 100.
  const [sourceUploads, setSourceUploads] = useState<{ id: string; name: string; progress: number }[]>([]);
  // Files dragged over the chat attach to the next question when dropped.
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachToMessageInputRef = useRef<HTMLInputElement>(null);
  // Web Speech API has no official TS lib typing; SpeechRecognition here is
  // whatever constructor the browser exposes (vendor-prefixed on Chromium).
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const messages = useMemo(
    () => getActivePath({ nodes, activeLeafId }),
    [nodes, activeLeafId]
  );

  function handleModeChange(next: AskMode) {
    setMode(next);
    storeMode(next);
  }

  // Opens a conversation picked from the Sources page's copy of the
  // sidebar (that page navigates here with ?conversation=<id>, since the
  // chat UI itself only exists on this route). Reads location directly
  // rather than next/navigation's useSearchParams(), which would force a
  // Suspense boundary around this whole page for a value only read once,
  // on mount. The param is stripped right after so a refresh doesn't
  // reopen it and back/forward doesn't step through it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (!id) return;
    handleSelectConversation(id);
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Selecting text in an answer surfaces a floating "Reply" button near
  // the selection, so quoting part of an answer into a follow-up doesn't
  // require manually copying and retyping it. Only answer text counts
  // (the element marked data-answer-text in ChatMessageRow) - not
  // questions, reasoning, lookups or source lists - and the selection must
  // start and end in the same answer.
  useEffect(() => {
    function answerTextOf(node: Node | null): Element | null {
      const element = node instanceof Element ? node : (node?.parentElement ?? null);
      return element?.closest("[data-answer-text]") ?? null;
    }

    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setSelectionMenu(null);
        return;
      }
      const answer = answerTextOf(sel.anchorNode);
      if (
        !answer ||
        answer !== answerTextOf(sel.focusNode) ||
        !transcriptRef.current?.contains(answer)
      ) {
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
  // a sibling of what's already there instead of replacing it. `attachments`
  // is only meaningful for a normal send - editing/regenerating re-asks
  // without re-attaching whatever was attached the first time.
  async function runAsk(question: string, parentId: string | null, attachments: AttachmentInfo[] = []) {
    if (!question || pending) return;

    const tempUserId = makeId();
    const tempAssistantId = makeId();
    const now = Date.now();
    setNodes((prev) => ({
      ...prev,
      [tempUserId]: {
        id: tempUserId,
        parentId,
        role: "user",
        content: question,
        createdAt: now,
        attachments: attachments.length
          ? attachments.map((a) => ({ filename: a.filename, charCount: a.char_count }))
          : undefined,
      },
      [tempAssistantId]: {
        id: tempAssistantId,
        parentId: tempUserId,
        role: "assistant",
        content: "",
        toolEvents: [],
        research: mode === "research" ? { startedAt: now } : undefined,
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
        {
          conversationId,
          parentMessageId: parentId ?? "",
          webSearch: webSearchEnabled,
          attachmentIds: attachments.map((a) => a.id),
          mode,
        },
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
          onResearchPlan: (plan) => {
            updateAssistant((m) => (m.research ? { ...m, research: { ...m.research, plan } } : m));
          },
          onResearchProgress: (progress) => {
            updateAssistant((m) => (m.research ? { ...m, research: { ...m.research, progress } } : m));
          },
          onDone: ({
            sources,
            conversationId: nextConversationId,
            citations,
            citationWarnings,
            userMessageId,
            assistantMessageId,
            title,
            mode: answeredMode,
            notFound,
          }) => {
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
                  citationWarnings,
                  notFound,
                  mode: answeredMode,
                  research: assistantNode.research && {
                    ...assistantNode.research,
                    finishedAt: Date.now(),
                  },
                };
              }
              return next;
            });
            if (assistantMessageId) setActiveLeafId(assistantMessageId);
            if (nextConversationId) setConversationId(nextConversationId);
            if (title) setServerTitle(title);
            // Refresh so the sidebar picks up this turn's new/updated
            // title and recency without waiting for the next mount.
            history.refresh();
          },
          onError: (message) => {
            updateAssistant((m) => ({ ...m, role: "error", content: message }));
          },
        },
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped with the stop button (or by leaving the conversation,
        // which clears it anyway): keep whatever arrived, and say so.
        updateAssistant((m) => ({ ...m, stopped: true }));
      } else {
        updateAssistant((m) => ({
          ...m,
          role: "error",
          content: err instanceof Error ? err.message : "The request failed.",
        }));
      }
    } finally {
      // A research turn that stopped early (an error, or the user hit
      // stop) shouldn't keep its timer running.
      updateAssistant((m) =>
        m.research && !m.research.finishedAt ? { ...m, research: { ...m.research, finishedAt: Date.now() } } : m
      );
      setPending(false);
      abortRef.current = null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;
    setInput("");
    const attachments = pendingAttachments;
    setPendingAttachments([]);
    await runAsk(question, activeLeafId, attachments);
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
        // Answers saved with what they were built from come back with
        // the same sources, citations, warnings and reasoning as when
        // first asked.
        nextNodes[m.id] = {
          id: m.id,
          parentId: m.parent_message_id,
          role: m.role as ChatMessage["role"],
          content: m.content,
          createdAt: Date.parse(m.created_at),
          mode: m.mode ?? undefined,
          sources: m.sources ?? undefined,
          citations: m.citations ?? undefined,
          citationWarnings: m.citation_warnings ?? undefined,
          notFound: m.not_found ?? undefined,
          thinking: m.thinking ?? undefined,
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
      history.refresh();
    }
  }

  // The sidebar has already removed it (useConversationHistory); if it
  // was the one open, the chat goes back to a blank composer.
  function handleConversationDeleted(id: string) {
    if (id !== conversationId) return;
    abortRef.current?.abort();
    setNodes({});
    setActiveLeafId(null);
    setConversationId(undefined);
    setServerTitle(undefined);
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

  // Adds files to the shared Sources library from the composer. Each shows
  // as a chip above the composer while it uploads and then processes
  // (which can take minutes), and the toast at the end says how it went.
  async function handleAttachFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (attachInputRef.current) attachInputRef.current.value = "";

    let succeeded = 0;
    let firstError: string | null = null;
    for (const file of list) {
      const id = makeId();
      setSourceUploads((prev) => [...prev, { id, name: file.name, progress: 0 }]);
      try {
        await uploadDocumentWithProgress(file, (progress) =>
          setSourceUploads((prev) => prev.map((u) => (u.id === id ? { ...u, progress } : u)))
        );
        succeeded += 1;
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : "Upload failed.";
      } finally {
        setSourceUploads((prev) => prev.filter((u) => u.id !== id));
      }
    }

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

  // Unlike handleAttachFiles above (which ingests into the permanent,
  // searchable Sources corpus), this attaches a file to the *next*
  // message only - its text rides along with that one question and the
  // backend discards it afterward. Sequential (not parallel) so a slow
  // upload doesn't race the pendingAttachments state update below.
  async function handleAttachToMessage(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setAttachingToMessage(true);
    let firstError: string | null = null;
    for (const file of list) {
      try {
        const info = await uploadAttachment(file);
        setPendingAttachments((prev) => [...prev, info]);
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : "Attaching failed.";
      }
    }
    setAttachingToMessage(false);
    if (attachToMessageInputRef.current) attachToMessageInputRef.current.value = "";
    if (firstError) {
      toast.add({ title: "Couldn't attach file", description: firstError, type: "error" });
    }
  }

  function handleRemovePendingAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  const composer = (
    <form onSubmit={handleSubmit} className="w-full">
      {(pendingAttachments.length > 0 || attachingToMessage || sourceUploads.length > 0) && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {sourceUploads.map((u) => (
            <span
              key={u.id}
              className="flex max-w-64 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
              title={u.name}
            >
              <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{u.name}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {u.progress < 100 ? `Uploading ${u.progress}%` : "Adding to Sources…"}
              </span>
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            </span>
          ))}
          {pendingAttachments.map((a) => (
            <AttachmentChip
              key={a.id}
              filename={a.filename}
              charCount={a.char_count}
              onRemove={() => handleRemovePendingAttachment(a.id)}
            />
          ))}
          {attachingToMessage && (
            <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Attaching…
            </span>
          )}
        </div>
      )}
      <InputGroup
        className="rounded-2xl border border-border bg-card p-1 shadow-xs transition-colors focus-within:border-brand/60 hover:border-foreground/20"
        style={{ "--ring": "var(--brand)" } as React.CSSProperties}
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
          placeholder={mode === "research" ? "Ask a question to research…" : "Ask a question…"}
          aria-label="Question"
          rows={1}
          className="max-h-[40dvh] min-h-10 px-3.5 pt-2.5 text-base sm:max-h-48 sm:text-[15px]"
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
              <DropdownMenuContent side="top" align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
                    Add a file
                  </DropdownMenuLabel>
                  {[
                    {
                      icon: PaperclipIcon,
                      label: "Attach to this message",
                      description: "Read with this question only. It isn't added to Sources.",
                      onClick: () => attachToMessageInputRef.current?.click(),
                    },
                    {
                      icon: FolderOpenIcon,
                      label: "Add to Sources",
                      description: "Searchable in every conversation, for everyone. Takes a few minutes to process.",
                      onClick: () => attachInputRef.current?.click(),
                    },
                  ].map(({ icon: Icon, label, description, onClick }) => (
                    <DropdownMenuItem key={label} onClick={onClick} className="items-start gap-2.5 py-2">
                      <Icon className="mt-0.5 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{label}</span>
                        <span className="text-xs leading-snug whitespace-normal text-muted-foreground">
                          {description}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              type="button"
              variant={webSearchEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setWebSearchEnabled((v) => !v)}
              aria-pressed={webSearchEnabled}
              aria-label="Search the web"
              title="Also search the web for this question"
              className="gap-1.5"
            >
              <GlobeIcon data-icon="inline-start" />
              <span className="hidden sm:inline">Search the web</span>
            </InputGroupButton>
            <ModePicker value={mode} onChange={handleModeChange} disabled={pending} />
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
          <input
            ref={attachToMessageInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) handleAttachToMessage(e.target.files);
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
                disabled={!input.trim() || attachingToMessage}
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

  const ModeIcon = MODES[mode].icon;
  const conversationTitle =
    serverTitle ?? (messages.length > 0 ? titleFromQuestion(messages[0].content) : undefined);

  return (
    <div className="bg-page-gradient flex h-dvh w-full overflow-hidden">
      {selectionMenu && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full animate-in fade-in zoom-in-95 pb-2 duration-100"
          style={{ top: selectionMenu.top, left: selectionMenu.left }}
        >
          <Button
            variant="default"
            size="sm"
            className="shadow-md"
            onClick={handleReplyToSelection}
          >
            <ReplyIcon data-icon="inline-start" />
            Reply
          </Button>
        </div>
      )}

      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border lg:flex">
        <Sidebar
          history={history}
          activeConversationId={conversationId}
          sourcesActive={false}
          onNewConversation={handleNewConversation}
          onSelectConversation={handleSelectConversation}
          onDeleted={handleConversationDeleted}
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
          <Sidebar
            history={history}
            activeConversationId={conversationId}
            sourcesActive={false}
            onNewConversation={handleNewConversation}
            onSelectConversation={handleSelectConversation}
            onDeleted={handleConversationDeleted}
          />
        </SheetContent>
      </Sheet>

      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragActive(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragActive(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragActive(false);
          if (pending) {
            toast.add({ title: "Wait for this answer to finish, then drop the file again", type: "error" });
            return;
          }
          handleAttachToMessage(Array.from(e.dataTransfer.files));
        }}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-[color-mix(in_oklch,var(--background)_88%,var(--brand))] text-center animate-in fade-in duration-150">
            <PaperclipIcon className="size-6 text-foreground" />
            <p className="font-heading text-base font-semibold text-foreground">Drop to attach to your next question</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Read with that question only. To add a file for everyone, use Add to Sources.
            </p>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <MenuIcon />
            </Button>
            <span className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
              {conversationTitle ?? "Fayda አንባቢ"}
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
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:pb-[18vh]">
            <div className="flex w-full max-w-2xl flex-col gap-5 animate-in fade-in duration-300">
              <div className="px-1">
                <h1 className="font-heading text-[clamp(1.5rem,4.2vw,2.125rem)] leading-tight font-bold tracking-[-0.02em] text-balance text-foreground">
                  What should አንባቢ read for you?
                </h1>
              </div>
              {composer}
              <p className="flex items-start gap-1.5 px-1 text-xs text-muted-foreground" aria-live="polite">
                <ModeIcon className="mt-px size-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{MODES[mode].label}:</span> {MODES[mode].description}
                </span>
              </p>
            </div>
          </div>
        ) : (
          <>
            <MessageScrollerProvider>
              <MessageScroller className="min-h-0 flex-1 animate-in fade-in duration-300">
                <MessageScrollerViewport onScroll={() => setSelectionMenu(null)}>
                  <MessageScrollerContent
                    ref={transcriptRef}
                    className="mx-auto w-full max-w-2xl gap-0 px-3 py-6 sm:px-4"
                  >
                    {messages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                        className={cn(
                          // A question sits close to its answer; turns are
                          // spaced apart from each other.
                          message.role === "user" ? "pt-8 first:pt-0" : "pt-1",
                          removingIds.has(message.id)
                            ? "animate-out fade-out slide-out-to-top-1 duration-180 fill-mode-forwards ease-in"
                            : "animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out fill-mode-both"
                        )}
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
            <div className="shrink-0 animate-in fade-in px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] duration-300 sm:px-4 sm:pb-5">
              <div className="mx-auto w-full max-w-2xl">{composer}</div>
            </div>
          </>
        )}
      </div>
    </div>
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

function AttachmentChip({
  filename,
  charCount,
  onRemove,
}: {
  filename: string;
  charCount: number;
  onRemove?: () => void;
}) {
  return (
    <span className="flex max-w-56 items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-2.5 text-xs">
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate" title={filename}>
        {filename}
      </span>
      <span className="shrink-0 text-muted-foreground">
        {charCount >= 1000 ? `${Math.round(charCount / 1000)}k` : charCount} chars
      </span>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-4 shrink-0"
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
        >
          <XIcon className="size-3" />
        </Button>
      )}
    </span>
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
                className="min-h-16 resize-none text-sm shadow-none focus-visible:ring-0"
                style={{ "--ring": "var(--brand)" } as React.CSSProperties}
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
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1 flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((a, i) => (
                <AttachmentChip key={i} filename={a.filename} charCount={a.charCount} />
              ))}
            </div>
          )}
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">
              {message.content}
            </BubbleContent>
          </Bubble>
          <MessageFooter className="justify-end gap-1">
            <BranchSwitcher siblings={siblings} activeId={message.id} pending={pending} onSwitch={onSwitchBranch} />
            <div className="flex translate-y-0.5 gap-0.5 opacity-0 transition-[opacity,transform] duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover/message:translate-y-0 group-hover/message:opacity-100 touch:translate-y-0 touch:opacity-100">
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
        {message.research && (
          <ResearchProgress
            plan={message.research.plan}
            progress={message.research.progress}
            startedAt={message.research.startedAt}
            finishedAt={message.research.finishedAt}
            answering={Boolean(message.content) || message.research.finishedAt !== undefined}
            stopped={message.stopped}
          />
        )}

        {!message.research && message.toolEvents && message.toolEvents.length > 0 && (
          <Collapsible defaultOpen={toolsDefaultOpen}>
            <CollapsibleTrigger className="group/trigger flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronDownIcon className="size-3.5 transition-transform group-aria-expanded/trigger:rotate-180" />
              {isStreaming
                ? toolLabel(message.toolEvents[message.toolEvents.length - 1].name, message.toolEvents[message.toolEvents.length - 1].phase) + "…"
                : `Steps (${message.toolEvents.filter((ev) => ev.phase === "call").length})`}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 flex flex-col gap-1">
              {message.toolEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-baseline gap-2 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
                >
                  <span className="shrink-0 font-medium">{toolLabel(ev.name, ev.phase)}</span>
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

        {message.stopped && !message.content ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <CircleStopIcon className="size-4" />
            Stopped before an answer arrived.
            <Button variant="outline" size="xs" onClick={() => onRegenerate(message.id)} disabled={pending}>
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          </div>
        ) : isStreaming && message.research ? null : isStreaming ? (
          <Marker role="status">
            <MarkerContent className="shimmer font-medium">Thinking…</MarkerContent>
          </Marker>
        ) : (
          <Bubble variant="ghost">
            <BubbleContent>
              <div className="chat-markdown" data-answer-text>
                <ChartSourcesContext.Provider value={{ sources: message.sources, messageId: message.id }}>
                {message.citations && message.citations.length > 0 ? (
                  // Answer is complete: render the clean, structured
                  // citation breakdown rather than the raw streamed text
                  // (which may still contain literal "[N]" markers as the
                  // model generated them).
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {buildCitedMarkdown(message.citations, message.sources, message.id)}
                  </ReactMarkdown>
                ) : (
                  // Still streaming, or the answer had no citations —
                  // render the raw text as-is.
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {pending || message.sources?.length ? message.content : message.content.replace(CITATION_MARKERS, "")}
                  </ReactMarkdown>
                )}
                </ChartSourcesContext.Provider>
              </div>
            </BubbleContent>
          </Bubble>
        )}

        {!pending && message.notFound && <NotFound questions={message.notFound} />}

        {!pending && <CitationWarnings warnings={textWarnings(message.citationWarnings)} />}

        {!isStreaming && message.content && (
          <MessageFooter className="flex-wrap gap-x-2 gap-y-1">
            {message.stopped && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CircleStopIcon className="size-3.5" />
                Stopped early
              </span>
            )}
            {message.mode && (
              <AnswerMeta mode={message.mode} warningCount={textWarnings(message.citationWarnings).length} />
            )}
            <div className="flex translate-y-0.5 gap-0.5 opacity-0 transition-[opacity,transform] duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover/message:translate-y-0 group-hover/message:opacity-100 touch:translate-y-0 touch:opacity-100">
              <CopyButton content={plainAnswer(message)} onCopy={onCopy} label="Copy answer" />
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
            </div>
          </MessageFooter>
        )}

        {message.sources && message.sources.length > 0 && (
          <SourceList sources={message.sources} messageId={message.id} />
        )}
      </MessageContent>
    </Message>
  );
}

// Which mode answered this turn (the done event's `mode`), and for the
// modes that check citations, whether every cited sentence held up.
function AnswerMeta({ mode, warningCount }: { mode: NonNullable<ChatMessage["mode"]>; warningCount: number }) {
  const checked = mode !== "agent" && warningCount === 0;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium">{ANSWERED_LABELS[mode]}</span>
      {checked && (
        <span className="flex items-center gap-1" style={{ color: "var(--color-grounded-fg)" }}>
          <ShieldCheckIcon className="size-3.5" />
          Citations checked
        </span>
      )}
    </span>
  );
}
