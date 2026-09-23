const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

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
function errorMessageFrom(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.detail === "string") return parsed.detail;
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

export type AskStreamHandlers = {
  onThinking?: (token: string) => void;
  onAnswer?: (token: string) => void;
  onToolCall?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, preview: string) => void;
  onDone?: (
    sources: AskSource[],
    conversationId: string | undefined,
    citations: CitationSegment[],
    userMessageId: string | undefined,
    assistantMessageId: string | undefined,
    title: string | undefined
  ) => void;
  onError?: (message: string) => void;
};

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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      conversation_id: options.conversationId,
      parent_message_id: options.parentMessageId,
      ...(options.webSearch ? { web_search: true } : {}),
      ...(options.attachmentIds?.length ? { attachment_ids: options.attachmentIds } : {}),
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
      case "done":
        handlers.onDone?.(
          Array.isArray(payload.sources)
            ? payload.sources.map(normalizeSource)
            : [],
          typeof payload.conversation_id === "string"
            ? payload.conversation_id
            : undefined,
          Array.isArray(payload.citations)
            ? payload.citations
                .map(normalizeCitationSegment)
                .filter((s): s is CitationSegment => s !== null)
            : [],
          typeof payload.user_message_id === "string" ? payload.user_message_id : undefined,
          typeof payload.assistant_message_id === "string" ? payload.assistant_message_id : undefined,
          typeof payload.title === "string" ? payload.title : undefined
        );
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

export async function listDocuments(): Promise<DocumentEntry[]> {
  const res = await fetch(new URL("/documents", API_BASE));
  return handleResponse<DocumentEntry[]>(res);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch(new URL("/conversations", API_BASE));
  return handleResponse<ConversationSummary[]>(res);
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(new URL(`/conversations/${encodeURIComponent(id)}`, API_BASE));
  return handleResponse<ConversationDetail>(res);
}

export async function deleteConversationApi(id: string): Promise<void> {
  const res = await fetch(
    new URL(`/conversations/${encodeURIComponent(id)}`, API_BASE),
    { method: "DELETE" }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Request failed with status ${res.status}`);
  }
}

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(new URL("/upload", API_BASE), {
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
  const res = await fetch(new URL("/attachments", API_BASE), {
    method: "POST",
    body: formData,
  });
  return handleResponse<AttachmentInfo>(res);
}

// Uses XHR instead of fetch so we can report upload-body progress; once the
// body finishes sending, `onProgress` stops firing while the server chunks
// and embeds the file — callers should treat "stuck at 100%" as processing.
export function uploadDocumentWithProgress(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", new URL("/upload", API_BASE).toString());

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
        reject(new Error(xhr.responseText || `Request failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload."));

    xhr.send(formData);
  });
}

export async function deleteDocument(filename: string): Promise<DeleteResponse> {
  const res = await fetch(
    new URL(`/documents/${encodeURIComponent(filename)}`, API_BASE),
    { method: "DELETE" }
  );
  return handleResponse<DeleteResponse>(res);
}
