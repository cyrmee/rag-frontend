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
    summary: "Upload a document (PDF, DOCX, PPTX, XLSX) for chunking, embedding, and storage.",
    request: "multipart/form-data — file",
    response: "{ filename: string, chunks_ingested: number }",
  },
  {
    method: "POST",
    path: "/ask",
    summary: "Ask a question; retrieves the top-k most relevant chunks via vector similarity and streams a generated answer from them (SSE).",
    request: "{ question: string }",
    response: "SSE stream — event: thinking | answer | done | error",
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
