"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamAsk, type AskSource } from "@/lib/api";

type ToolEvent = {
  id: string;
  name: string;
  phase: "call" | "result";
  detail: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  thinking?: string;
  sources?: AskSource[];
  toolEvents?: ToolEvent[];
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [maxIterations, setMaxIterations] = useState(5);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set from the first response's done event, then reused for every
  // subsequent question so the backend treats this as one continuing
  // conversation (see GET /conversations/{id} to inspect it later).
  const conversationIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    const assistantId = makeId();
    setMessages((prev) => [
      ...prev,
      { id: makeId(), role: "user", content: question },
      { id: assistantId, role: "assistant", content: "", toolEvents: [] },
    ]);
    setInput("");
    setPending(true);
    scrollToBottom();

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
        { maxIterations, conversationId: conversationIdRef.current },
        {
          onThinking: (token) => {
            updateAssistant((m) => ({
              ...m,
              thinking: (m.thinking ?? "") + token,
            }));
          },
          onAnswer: (token) => {
            updateAssistant((m) => ({ ...m, content: m.content + token }));
            scrollToBottom();
          },
          onToolCall: (name, args) => {
            updateAssistant((m) => ({
              ...m,
              toolEvents: [
                ...(m.toolEvents ?? []),
                { id: makeId(), name, phase: "call", detail: formatArgs(args) },
              ],
            }));
            scrollToBottom();
          },
          onToolResult: (name, preview) => {
            updateAssistant((m) => ({
              ...m,
              toolEvents: [
                ...(m.toolEvents ?? []),
                { id: makeId(), name, phase: "result", detail: preview },
              ],
            }));
            scrollToBottom();
          },
          onDone: (sources, conversationId) => {
            if (conversationId) conversationIdRef.current = conversationId;
            updateAssistant((m) => ({ ...m, sources }));
          },
          onError: (message) => {
            updateAssistant((m) => ({ ...m, role: "error", content: message }));
          },
        },
        controller.signal
      );
    } catch (err) {
      updateAssistant((m) => ({
        ...m,
        role: "error",
        content: err instanceof Error ? err.message : "The request failed.",
      }));
    } finally {
      setPending(false);
      abortRef.current = null;
      scrollToBottom();
    }
  }

  return (
    <div className="major-surface chat-panel">
      <div className="chat-toolbar">
        <label className="chat-toggle">
          Max iterations
          <input
            type="number"
            min={1}
            max={10}
            value={maxIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value))}
            className="chat-iterations"
            aria-label="Maximum retrieval iterations"
          />
        </label>
      </div>

      <div
        className="chat-messages"
        ref={listRef}
        aria-live="polite"
        aria-busy={pending}
      >
        {messages.length === 0 && (
          <p className="chat-empty">
            No exchanges yet. Ask a question about the documents you&apos;ve
            ingested.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-bubble ${message.role}`}
            role={message.role === "error" ? "alert" : undefined}
          >
            <span className="chat-role">
              {message.role === "user"
                ? "You"
                : message.role === "assistant"
                  ? "Answer"
                  : "Error"}
            </span>

            {message.toolEvents && message.toolEvents.length > 0 && (
              <div className="chat-tool-log">
                {message.toolEvents.map((ev) => (
                  <div key={ev.id} className={`chat-tool-event ${ev.phase}`}>
                    <span className="chat-tool-arrow" aria-hidden="true">
                      {ev.phase === "call" ? "→" : "←"}
                    </span>
                    <span className="chat-tool-name">{ev.name}</span>
                    {ev.detail && (
                      <span className="chat-tool-detail">{ev.detail}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {message.thinking && (
              <details className="chat-thinking">
                <summary>Reasoning</summary>
                <p>{message.thinking}</p>
              </details>
            )}

            {message.role === "assistant" ? (
              <div className="chat-content chat-markdown">
                {message.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                ) : (
                  <p>{pending ? "…" : ""}</p>
                )}
              </div>
            ) : (
              <p className="chat-content">{message.content}</p>
            )}

            {message.sources && message.sources.length > 0 && (
              <div className="chat-citations">
                <span className="chat-citations-label">Sources</span>
                <ul className="chat-sources">
                  {message.sources.map((source, i) => {
                    const label = source.filename ?? source.content ?? "source";
                    const page = formatUnit(source.source_format, source.page_number);
                    return (
                      <li key={`${message.id}-${i}`} className="chat-source-tag">
                        {source.document_url ? (
                          <a
                            href={source.document_url}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {label}
                            {page}
                          </a>
                        ) : (
                          <>
                            {label}
                            {page}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
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
          rows={2}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
