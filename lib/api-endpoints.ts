export type ApiEndpoint = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  summary: string;
  request?: string;
  response?: string;
};

export const apiEndpoints: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/me",
    summary: "The signed-in user the access token belongs to.",
    response: "{ id: string, username: string, email: string | null, name: string | null }",
  },
  {
    method: "POST",
    path: "/upload",
    summary: "Upload a document (PDF, DOCX, PPTX, XLSX, TXT, MD) for chunking, embedding, and storage.",
    request: "multipart/form-data — file",
    response: "{ filename: string, chunks_ingested: number }",
  },
  {
    method: "POST",
    path: "/attachments",
    summary: "Attach a file to one chat message. Its text rides along with that question only and is not added to Sources.",
    request: "multipart/form-data — file",
    response: "{ id: string, filename: string, char_count: number }",
  },
  {
    method: "POST",
    path: "/ask",
    summary:
      "Ask a question, streamed as Server-Sent Events. `mode` picks how it is answered: agent (quick), council (parallel searches plus a citation check) or research (multi-round reading, minutes). Omitted, the backend routes between agent and council per question.",
    request:
      "{ question: string, conversation_id?: string, parent_message_id?: string, web_search?: boolean, attachment_ids?: string[], mode?: 'agent' | 'council' | 'research' }  (query param: max_iterations? 1-10)",
    response:
      "SSE events: thinking/answer (tokens), tool_call/tool_result, research_plan/research_progress (research mode), then one done with { sources, conversation_id, citations, charts, citation_warnings, mode, not_found, user_message_id, assistant_message_id, title }",
  },
  {
    method: "GET",
    path: "/conversations",
    summary: "List conversations (id, timestamps, first question as a preview), most recently updated first.",
    response: "[{ id: string, created_at: string, updated_at: string, first_question: string | null }]",
  },
  {
    method: "GET",
    path: "/conversations/{conversation_id}",
    summary: "Every message in every branch of one conversation.",
    response: "{ id, title, active_message_id, messages: [{ id, parent_message_id, role, content, created_at, mode, sources, citations, citation_warnings, not_found, thinking }] } - the answer fields are what its done event carried, null for questions and for answers saved before 13 October 2026",
  },
  {
    method: "DELETE",
    path: "/conversations/{conversation_id}",
    summary: "Delete one of the signed-in user's conversations.",
    response: "{ id: string }",
  },
  {
    method: "GET",
    path: "/documents",
    summary:
      "One page of the ingested documents in filename order, searchable by filename. `total` is the match count, for paging.",
    request: "query params: q? (case-insensitive filename substring, up to 200 characters), limit? (1-500, default 50), offset? (default 0)",
    response: "{ documents: [{ filename: string, chunk_count: number }], total: number, limit: number, offset: number }",
  },
  {
    method: "DELETE",
    path: "/documents/{filename}",
    summary: "Delete a document and all of its chunks by filename.",
    response: "{ filename: string, chunks_deleted: number }",
  },
];
