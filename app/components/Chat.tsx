"use client";

import { useEffect, useId, useRef, useState, type AnchorHTMLAttributes } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamAsk, type AskSource, type CitationSegment } from "@/lib/api";
import {
  deleteConversation,
  loadConversations,
  saveConversation,
  titleFromQuestion,
  type ChatMessage,
  type StoredConversation,
} from "@/lib/conversations";
import DocumentPanel from "@/app/components/DocumentPanel";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FolderOpenIcon,
  MenuIcon,
  PencilIcon,
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
  // useId() (not makeId()) here: it's guaranteed to match between the
  // server-rendered HTML and the client's first render, unlike
  // crypto.randomUUID(), which would produce a different value on each side
  // and trigger a hydration mismatch.
  const initialSessionId = useId();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [history, setHistory] = useState<StoredConversation[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Populated after mount only — reading localStorage during the initial
  // render would return different values on the server vs. the client and
  // trigger a hydration mismatch.
  useEffect(() => {
    setHistory(loadConversations());
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
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

  // Persist the active session a moment after messages settle, instead of on
  // every streamed token, so a fast-typing/fast-streaming turn doesn't hammer
  // localStorage.
  useEffect(() => {
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return;
    const timeout = setTimeout(() => {
      saveConversation({
        id: sessionId,
        title: titleFromQuestion(firstUser.content),
        updatedAt: Date.now(),
        conversationId,
        messages,
      });
      setHistory(loadConversations());
    }, 400);
    return () => clearTimeout(timeout);
  }, [messages, conversationId, sessionId]);

  // Shared by a normal send and an edited/rebranched turn. `priorMessages` is
  // everything that should stay in the transcript before this question;
  // `startFresh` drops the server-side conversation memory, since branching
  // from an earlier point means the backend's linear history no longer
  // matches what the user sees.
  async function runAsk(
    question: string,
    priorMessages: ChatMessage[],
    startFresh: boolean
  ) {
    if (!question || pending) return;

    const assistantId = makeId();
    const now = Date.now();
    setMessages([
      ...priorMessages,
      { id: makeId(), role: "user", content: question, createdAt: now },
      { id: assistantId, role: "assistant", content: "", toolEvents: [], createdAt: now },
    ]);
    setPending(true);
    const activeConversationId = startFresh ? undefined : conversationId;
    if (startFresh) setConversationId(undefined);

    function updateAssistant(patch: (message: ChatMessage) => ChatMessage) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? patch(m) : m))
      );
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAsk(
        question,
        { conversationId: activeConversationId },
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
          onDone: (sources, nextConversationId, citations) => {
            updateAssistant((m) => ({ ...m, sources, citations }));
            if (nextConversationId) setConversationId(nextConversationId);
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
    await runAsk(question, messages, false);
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleDeletePair(userMessageId: string) {
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === userMessageId);
      if (index === -1) return prev;
      const nextRole = prev[index + 1]?.role;
      const hasPairedResponse = nextRole === "assistant" || nextRole === "error";
      return prev.filter(
        (_, i) => i !== index && !(hasPairedResponse && i === index + 1)
      );
    });
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
    const index = messages.findIndex((m) => m.id === id);
    if (index === -1) return;
    const priorMessages = messages.slice(0, index);
    setEditingId(null);
    setEditValue("");
    await runAsk(question, priorMessages, true);
  }

  function handleNewConversation() {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(undefined);
    setPending(false);
    setSessionId(makeId());
    setMobileNavOpen(false);
  }

  function handleSelectConversation(stored: StoredConversation) {
    abortRef.current?.abort();
    setSessionId(stored.id);
    setMessages(stored.messages);
    setConversationId(stored.conversationId);
    setPending(false);
    setMobileNavOpen(false);
  }

  function handleDeleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    deleteConversation(id);
    setHistory((prev) => prev.filter((c) => c.id !== id));
    if (id === sessionId) {
      setMessages([]);
      setConversationId(undefined);
      setSessionId(makeId());
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

  const composer = (
    <form onSubmit={handleSubmit} className="w-full">
      <InputGroup
        className="rounded-3xl border-border/80 bg-card p-1 shadow-sm transition-colors focus-within:border-signal-gold/60 hover:border-foreground/20"
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
        <InputGroupAddon align="block-end" className="justify-end px-1.5 pb-1.5">
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
        </InputGroupAddon>
      </InputGroup>
    </form>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border lg:flex">
        <SidebarContent
          history={history}
          sessionId={sessionId}
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
            sessionId={sessionId}
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
              ፋይዳ አንባቢ
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
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-24">
            <Empty className="border-none p-0">
              <EmptyTitle className="text-2xl font-semibold">
                What should Anbabi read for you?
              </EmptyTitle>
            </Empty>
            <div className="w-full max-w-2xl">{composer}</div>
          </div>
        ) : (
          <>
            <MessageScrollerProvider>
              <MessageScroller className="min-h-0 flex-1 animate-in fade-in duration-300">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto w-full max-w-2xl px-4 py-6">
                    {messages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                        className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both"
                      >
                        <ChatMessageRow
                          message={message}
                          pending={pending}
                          onCopy={handleCopy}
                          isEditing={editingId === message.id}
                          editValue={editValue}
                          onEditValueChange={setEditValue}
                          onStartEdit={handleStartEdit}
                          onCancelEdit={handleCancelEdit}
                          onSubmitEdit={handleSubmitEdit}
                          onDelete={handleDeletePair}
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
      </div>

      <Sheet open={docsOpen} onOpenChange={setDocsOpen}>
        <SheetContent className="flex w-full flex-col gap-0 p-4 sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>Sources</SheetTitle>
          </SheetHeader>
          <DocumentPanel />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SidebarContent({
  history,
  sessionId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onOpenSources,
}: {
  history: StoredConversation[];
  sessionId: string;
  onNewConversation: () => void;
  onSelectConversation: (stored: StoredConversation) => void;
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
          ፋይዳ አንባቢ
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-signal-gold"
          />
        </span>
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        <SidebarItem icon={SquarePenIcon} label="New chat" onClick={onNewConversation} />
        <SidebarItem icon={FolderOpenIcon} label="Sources" onClick={onOpenSources} />
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
            {history.map((conv) => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConversation(conv)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectConversation(conv);
                  }
                }}
                className="group/history-row flex cursor-pointer items-center justify-between gap-2 rounded-full px-3 py-2 text-left text-sm transition-[background-color,transform] duration-150 hover:bg-sidebar-accent active:scale-[0.98] data-[active=true]:bg-[oklch(from_var(--color-signal-gold)_l_c_h_/_0.2)]"
                data-active={conv.id === sessionId}
              >
                <span className="min-w-0 flex-1 truncate text-white">
                  {conv.title}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-sidebar-foreground opacity-0 hover:bg-white/15 hover:text-white group-hover/history-row:opacity-100"
                  onClick={(e) => onDeleteConversation(conv.id, e)}
                  aria-label={`Delete ${conv.title}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm font-medium text-white transition-[background-color,transform] duration-150 hover:bg-sidebar-accent active:scale-[0.98]"
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

function ChatMessageRow({
  message,
  pending,
  onCopy,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
}: {
  message: ChatMessage;
  pending: boolean;
  onCopy: (content: string) => void;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: (id: string, content: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string) => void;
  onDelete: (id: string) => void;
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
          <MessageFooter className="translate-y-0.5 justify-end gap-0.5 opacity-0 transition-[opacity,transform] duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover/message:translate-y-0 group-hover/message:opacity-100">
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
