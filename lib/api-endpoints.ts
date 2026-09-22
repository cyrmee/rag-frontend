export type ApiEndpoint = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  summary: string;
  request?: string;
  response?: string;
};

export const apiEndpoints: ApiEndpoint[] = [
  {
    method: "POST",
    path: "/upload",
    summary: "Upload a document (PDF, DOCX, PPTX, XLSX, TXT, MD) for chunking, embedding, and storage.",
    request: "multipart/form-data — file",
    response: "{ filename: string, chunks_ingested: number }",
  },
  {
    method: "POST",
    path: "/ask",
    summary:
      "Ask a question. Always agentic and always streamed as Server-Sent Events (no single-pass or non-streaming variant) — the model decides when/how many times to retrieve, and can call list_documents (corpus meta-questions) or describe_image (a deeper look at a figure). Pass a prior response's conversation_id to continue that conversation.",
    request: "{ question: string, conversation_id?: string }  (query param: max_iterations? 1-10)",
    response:
      "SSE events: thinking/answer (tokens), tool_call/tool_result, then one done with { sources: SourceInfo[], conversation_id: string }",
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
    summary: "Full turn history for one conversation.",
    response: "[{ role: 'user' | 'assistant', content: string }]",
  },
  {
    method: "GET",
    path: "/documents",
    summary: "List all ingested documents with their chunk counts.",
    response: "[{ filename: string, chunk_count: number }]",
  },
  {
    method: "DELETE",
    path: "/documents/{filename}",
    summary: "Delete a document and all of its chunks by filename.",
    response: "{ filename: string, chunks_deleted: number }",
  },
];
