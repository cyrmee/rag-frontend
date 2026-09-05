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
    summary: "Ask a question; retrieves the top-k most relevant chunks via vector similarity and generates an answer from them.",
    request: "{ question: string }",
    response: "{ answer: string, sources: string[] }",
  },
  {
    method: "POST",
    path: "/ask/agentic",
    summary: "Agentic variant of /ask — runs a multi-step retrieval loop (optionally capped via ?max_iterations=1-10) before generating an answer.",
    request: "{ question: string }  (query param: max_iterations?)",
    response: "{ answer: string, sources: string[] }",
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
