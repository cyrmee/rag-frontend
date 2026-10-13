import { getAccessToken, signInAgain } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// Every backend route except /health needs the signed-in user's access
// token. A 401 means Keycloak's session is gone or the token was
// rejected - send the user back through the login page.
async function apiFetch(input: URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await getAccessToken()}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) signInAgain();
  return res;
}

export type DocumentEntry = {
  filename: string;
  chunk_count: number;
};

export type UploadResponse = {
  filename: string;
  chunks_ingested: number;
};

export type DeleteResponse = {
  filename: string;
  chunks_deleted: number;
};

// From POST /attachments - a file attached to one chat message, not the
// searchable document corpus (see UploadResponse/DocumentEntry for that).
// `char_count` is what the backend's combined-attachments budget for one
// message is measured against - not file count.
export type AttachmentInfo = {
  id: string;
  filename: string;
  char_count: number;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  first_question: string | null;
};

export type ConversationMessageNode = {
  id: string;
  parent_message_id: string | null;
  role: string;
  content: string;
  created_at: string;
  // What an answer was built from, saved with it (the same values its
  // /ask done event carried) - null for questions, and for answers saved
  // before the backend began storing them.
  mode?: AnsweredMode | null;
  sources?: AskSource[] | null;
  citations?: CitationSegment[] | null;
  citation_warnings?: CitationWarning[] | null;
  not_found?: string[] | null;
  // The model's reasoning on the way to the answer, as it streamed.
  thinking?: string | null;
};

export type ConversationDetail = {
  id: string;
  title: string | null;
  active_message_id: string | null;
  // Every message in every branch, not just the active path - see
  // app/schemas.py's ConversationDetail.
  messages: ConversationMessageNode[];
};

// FastAPI's standard error shape is {"detail": "..."} - unwrap that so an
// error bubble shows the actual message instead of raw JSON.
// Some routes put an object in `detail` instead: /upload's 409 for a file
// identical to one already uploaded is {message, existing_filename}, and
// a validation failure (422) is a list of {msg}.
function errorMessageFrom(body: string, status: number): string {
  try {
    const detail = JSON.parse(body)?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail?.existing_filename === "string") {
      return `This file is identical to “${detail.existing_filename}”, which is already in Sources.`;
    }
    if (typeof detail?.message === "string") return detail.message;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;
  } catch {
    // not JSON, fall through to the raw body
  }
  return body || `Request failed with status ${status}`;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(errorMessageFrom(body, res.status));
  }
  return res.json() as Promise<T>;
}

async function* readSSE(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator: number;
    while ((separator = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);

      let eventName = "message";
      const dataLines: string[] = [];
      // Per the SSE spec, only a single leading space right after the
      // colon is stripped — the rest of the value (including further
      // leading spaces, which are meaningful token/word boundaries) is
      // kept as-is.
      const stripField = (line: string, prefixLen: number) => {
        const value = line.slice(prefixLen);
        return value.startsWith(" ") ? value.slice(1) : value;
      };
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) eventName = stripField(line, 6);
        else if (line.startsWith("data:")) dataLines.push(stripField(line, 5));
      }
      if (dataLines.length === 0) continue;

      const raw = dataLines.join("\n");
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // non-JSON payload, keep raw string
      }
      yield { event: eventName, data };
    }
  }
}

export type AskSource = {
  content?: string;
  filename?: string;
  source_type?: string;
  source_format?: string;
  page_number?: number | null;
  document_url?: string | null;
};

function normalizeSource(raw: unknown): AskSource {
  if (typeof raw === "string") return { content: raw };
  if (raw && typeof raw === "object") return raw as AskSource;
  return {};
}

// The clean, structured citation breakdown - see app/agent.py's
// _segment_citations(). source_indices are 1-based positions into the
// `sources` array from the same done event (index N -> sources[N-1]).
// An empty-text segment ({text: "", source_indices: []}) marks a
// paragraph break in the original answer - rejoining segment text with
// "\n" reconstructs the original paragraph/list structure exactly (a
// single "\n" between real segments is just a soft wrap in CommonMark;
// an empty segment between two real ones produces the blank line needed
// to start a new paragraph/list).
export type CitationSegment = {
  text: string;
  source_indices: number[];
};

function normalizeCitationSegment(raw: unknown): CitationSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.text !== "string") return null;
  const indices = Array.isArray(obj.source_indices)
    ? obj.source_indices.filter((n): n is number => typeof n === "number")
    : [];
  return { text: obj.text, source_indices: indices };
}

// How the backend answers a question - see AskRequest.mode in the
// backend's app/schemas.py. "auto" sends no mode, letting the backend's
// classifier route complex questions to council and simple ones to the
// agent. Research is never chosen automatically.
export type AskMode = "auto" | "agent" | "council" | "research";
export type AnsweredMode = Exclude<AskMode, "auto">;

// A flagged sentence from the done event's citation_warnings - from the
// citation check (council and research mode), or a chart whose values no
// cited source states (every mode).
export type CitationWarning = {
  text: string;
  source_indices: number[];
  reason: string;
};

// Research mode's plan, sent once near the start of the turn.
export type ResearchPlan = {
  subQuestions: string[];
  documents: string[];
  webQueries: string[];
};

// Sent as each research stage moves. `done`/`total` count batches of
// passages while reading; `round` is 0 for plan and write, which happen
// once, outside the search rounds.
export type ResearchStage = "plan" | "search" | "read" | "check" | "gaps" | "write";
export type ResearchProgress = {
  stage: ResearchStage;
  round: number;
  message: string;
  done?: number;
  total?: number;
};

export type AskDone = {
  sources: AskSource[];
  conversationId: string | undefined;
  citations: CitationSegment[];
  citationWarnings: CitationWarning[];
  userMessageId: string | undefined;
  assistantMessageId: string | undefined;
  // Only set the first time a brand-new conversation completes.
  title: string | undefined;
  mode: AnsweredMode | undefined;
  // Research mode: sub-questions the documents didn't answer.
  notFound: string[];
};

export type AskStreamHandlers = {
  onThinking?: (token: string) => void;
  onAnswer?: (token: string) => void;
  onToolCall?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, preview: string) => void;
  onResearchPlan?: (plan: ResearchPlan) => void;
  onResearchProgress?: (progress: ResearchProgress) => void;
  onDone?: (done: AskDone) => void;
  onError?: (message: string) => void;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function normalizeWarning(raw: unknown): CitationWarning | null {
  const segment = normalizeCitationSegment(raw);
  if (!segment) return null;
  const reason = (raw as Record<string, unknown>).reason;
  return { ...segment, reason: typeof reason === "string" ? reason : "" };
}

const ANSWERED_MODES: AnsweredMode[] = ["agent", "council", "research"];
const RESEARCH_STAGES: ResearchStage[] = ["plan", "search", "read", "check", "gaps", "write"];

export async function streamAsk(
  question: string,
  options: {
    maxIterations?: number;
    conversationId?: string;
    // The message this turn should attach under. Omit to continue the
    // conversation normally (the backend uses its current tip). Pass ""
    // to branch from before the very first message (editing/regenerating
    // it), or an earlier message's id to branch from anywhere else - see
    // AskRequest.parent_message_id on the backend.
    parentMessageId?: string;
    // Exposes the web_search tool to the model for this turn only - off
    // by default.
    webSearch?: boolean;
    // Ids from prior uploadAttachment() calls - their extracted text is
    // folded into this turn's question server-side, then discarded (not
    // persisted with the turn). The backend rejects the request (413) if
    // the combined attached content is over budget.
    attachmentIds?: string[];
    // Omitted or "auto": the backend picks agent or council per question.
    mode?: AskMode;
  },
  handlers: AskStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  // The backend is always agentic and always streamed now - there's a
  // single POST /ask, not separate /ask/stream and /ask/agentic/stream
  // routes.
  const url = new URL("/ask", API_BASE);
  if (options.maxIterations) {
    url.searchParams.set("max_iterations", String(options.maxIterations));
  }

  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      conversation_id: options.conversationId,
      parent_message_id: options.parentMessageId,
      ...(options.webSearch ? { web_search: true } : {}),
      ...(options.attachmentIds?.length ? { attachment_ids: options.attachmentIds } : {}),
      ...(options.mode && options.mode !== "auto" ? { mode: options.mode } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(errorMessageFrom(body, res.status));
  }

  for await (const { event, data } of readSSE(res.body)) {
    // `thinking`/`answer` events carry a raw text token as the payload;
    // `tool_call`/`tool_result`/`done`/`error` carry a JSON object. A
    // digit-only or boolean token (e.g. "256") parses as a JS number/boolean
    // rather than a string — treat those as tokens too instead of dropping them.
    const token =
      typeof data === "string"
        ? data
        : typeof data === "number" || typeof data === "boolean"
          ? String(data)
          : undefined;
    const payload = (
      typeof data === "object" && data !== null ? data : {}
    ) as Record<string, unknown>;

    switch (event) {
      case "thinking":
        handlers.onThinking?.(
          token ??
            String(payload.token ?? payload.content ?? payload.text ?? "")
        );
        break;
      case "answer":
        handlers.onAnswer?.(
          token ??
            String(payload.token ?? payload.content ?? payload.text ?? "")
        );
        break;
      case "tool_call":
        handlers.onToolCall?.(String(payload.name ?? ""), payload.args);
        break;
      case "tool_result":
        handlers.onToolResult?.(
          String(payload.name ?? ""),
          String(payload.preview ?? "")
        );
        break;
      case "research_plan":
        handlers.onResearchPlan?.({
          subQuestions: strings(payload.sub_questions),
          documents: strings(payload.documents),
          webQueries: strings(payload.web_queries),
        });
        break;
      case "research_progress":
        if (RESEARCH_STAGES.includes(payload.stage as ResearchStage)) {
          handlers.onResearchProgress?.({
            stage: payload.stage as ResearchStage,
            round: typeof payload.round === "number" ? payload.round : 0,
            message: String(payload.message ?? ""),
            done: typeof payload.done === "number" ? payload.done : undefined,
            total: typeof payload.total === "number" ? payload.total : undefined,
          });
        }
        break;
      case "done":
        handlers.onDone?.({
          sources: Array.isArray(payload.sources) ? payload.sources.map(normalizeSource) : [],
          conversationId: typeof payload.conversation_id === "string" ? payload.conversation_id : undefined,
          citations: Array.isArray(payload.citations)
            ? payload.citations
                .map(normalizeCitationSegment)
                .filter((s): s is CitationSegment => s !== null)
            : [],
          citationWarnings: Array.isArray(payload.citation_warnings)
            ? payload.citation_warnings
                .map(normalizeWarning)
                .filter((w): w is CitationWarning => w !== null)
            : [],
          userMessageId: typeof payload.user_message_id === "string" ? payload.user_message_id : undefined,
          assistantMessageId:
            typeof payload.assistant_message_id === "string" ? payload.assistant_message_id : undefined,
          title: typeof payload.title === "string" ? payload.title : undefined,
          // Older backends only sent `council`.
          mode: ANSWERED_MODES.includes(payload.mode as AnsweredMode)
            ? (payload.mode as AnsweredMode)
            : typeof payload.council === "boolean"
              ? payload.council
                ? "council"
                : "agent"
              : undefined,
          notFound: strings(payload.not_found),
        });
        break;
      case "error":
        handlers.onError?.(
          token ??
            String(payload.message ?? payload.error ?? payload.detail ?? "Stream error")
        );
        break;
    }
  }
}

// One page of GET /documents: the matching documents in filename order
// from `offset`, and how many match in total (for paging).
export type DocumentPage = {
  documents: DocumentEntry[];
  total: number;
  limit: number;
  offset: number;
};

// `q` is a case-insensitive filename substring (folders included - the
// filename is the path); the backend searches and pages, the corpus being
// thousands of files.
// The file types Sources can be filtered by (GET /documents' `type`).
export const DOCUMENT_TYPES = ["pdf", "docx", "pptx", "xlsx", "txt", "md"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export async function listDocuments(
  options: { q?: string; limit?: number; offset?: number; folder?: string; type?: DocumentType } = {}
): Promise<DocumentPage> {
  const q = options.q?.trim() ?? "";
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const url = new URL("/documents", API_BASE);
  if (q) url.searchParams.set("q", q);
  if (options.folder) url.searchParams.set("folder", options.folder);
  if (options.type) url.searchParams.set("type", options.type);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const body = await handleResponse<DocumentPage | DocumentEntry[]>(await apiFetch(url));
  if (!Array.isArray(body)) return body;
  // A backend from before paging (released 13 October 2026) ignores the
  // parameters and sends every document - search and page it here so the
  // panel keeps working until that backend is redeployed.
  const needle = q.toLowerCase();
  const prefix = options.folder ? `${options.folder.replace(/\/+$/, "")}/` : "";
  const matches = body.filter(
    (d) =>
      (!needle || d.filename.toLowerCase().includes(needle)) &&
      (!prefix || d.filename.startsWith(prefix)) &&
      (!options.type || d.filename.toLowerCase().endsWith(`.${options.type}`))
  );
  return { documents: matches.slice(offset, offset + limit), total: matches.length, limit, offset };
}

// A folder in the library: filenames are paths, so a folder is a shared
// prefix. `document_count` counts everything under it, at any depth.
export type FolderEntry = {
  name: string;
  path: string;
  document_count: number;
};

// The folders directly inside `parent` (the top level when omitted).
// Resolves to null on a backend that can't list folders yet, so the page
// can leave folder browsing out rather than show an error.
export async function listFolders(parent?: string): Promise<FolderEntry[] | null> {
  const url = new URL("/documents/folders", API_BASE);
  if (parent) url.searchParams.set("parent", parent);
  const res = await apiFetch(url);
  // Older backends match /documents/folders to DELETE /documents/{filename}
  // only, so GET answers 405 (or 404).
  if (res.status === 404 || res.status === 405) return null;
  return handleResponse<FolderEntry[]>(res);
}

// One page of GET /conversations, most recently updated first.
// `nextCursor` fetches the page after it; null on the last page.
export type ConversationPage = {
  conversations: ConversationSummary[];
  nextCursor: string | null;
};

// `q` keeps conversations whose title or any question contains it.
export async function listConversations(
  options: { q?: string; cursor?: string | null; limit?: number } = {}
): Promise<ConversationPage> {
  const url = new URL("/conversations", API_BASE);
  const q = options.q?.trim();
  if (q) url.searchParams.set("q", q);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  url.searchParams.set("limit", String(options.limit ?? 50));
  const body = await handleResponse<
    { conversations: ConversationSummary[]; next_cursor: string | null } | ConversationSummary[]
  >(await apiFetch(url));
  if (!Array.isArray(body)) return { conversations: body.conversations, nextCursor: body.next_cursor };
  // A backend from before paging (released 13 October 2026) sends every
  // conversation and ignores the search - filter titles here instead.
  const needle = q?.toLowerCase();
  const matches = needle
    ? body.filter((c) => `${c.title ?? ""} ${c.first_question ?? ""}`.toLowerCase().includes(needle))
    : body;
  return { conversations: matches, nextCursor: null };
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await apiFetch(new URL(`/conversations/${encodeURIComponent(id)}`, API_BASE), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  await handleResponse<unknown>(res);
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await apiFetch(new URL(`/conversations/${encodeURIComponent(id)}`, API_BASE));
  return handleResponse<ConversationDetail>(res);
}

export async function deleteConversationApi(id: string): Promise<void> {
  const res = await apiFetch(
    new URL(`/conversations/${encodeURIComponent(id)}`, API_BASE),
    { method: "DELETE" }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(errorMessageFrom(body, res.status));
  }
}

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch(new URL("/upload", API_BASE), {
    method: "POST",
    body: formData,
  });
  return handleResponse<UploadResponse>(res);
}

// Attaches a file to one chat message rather than the searchable document
// corpus - see AttachmentInfo. The backend extracts and holds its text;
// this just returns the id/char_count so it can be shown and referenced.
export async function uploadAttachment(file: File): Promise<AttachmentInfo> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch(new URL("/attachments", API_BASE), {
    method: "POST",
    body: formData,
  });
  return handleResponse<AttachmentInfo>(res);
}

// Uses XHR instead of fetch so we can report upload-body progress; once the
// body finishes sending, `onProgress` stops firing while the server chunks
// and embeds the file — callers should treat "stuck at 100%" as processing.
export async function uploadDocumentWithProgress(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResponse> {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", new URL("/upload", API_BASE).toString());
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(new Error("The server returned an unreadable response."));
        }
      } else {
        if (xhr.status === 401) signInAgain();
        reject(new Error(errorMessageFrom(xhr.responseText, xhr.status)));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload."));

    xhr.send(formData);
  });
}

export async function deleteDocument(filename: string): Promise<DeleteResponse> {
  const res = await apiFetch(
    new URL(`/documents/${encodeURIComponent(filename)}`, API_BASE),
    { method: "DELETE" }
  );
  return handleResponse<DeleteResponse>(res);
}
