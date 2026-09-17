"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type DocumentEntry,
} from "@/lib/api";

export default function DocumentPanel() {
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setLoading(true);
      setDocuments(await listDocuments());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of an externally-owned list that is also manually refetched after mutations
    refresh();
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      await uploadDocument(file);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(filename: string) {
    try {
      setDeleting(filename);
      setError(null);
      await deleteDocument(filename);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="major-surface documents-panel">
        <div className="documents-body">
          {error && (
            <p className="documents-error" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <p className="documents-empty" aria-live="polite">
              Loading…
            </p>
          ) : documents.length === 0 ? (
            <p className="documents-empty">No documents ingested yet.</p>
          ) : (
            <ul className="documents-list">
              {documents.map((doc, i) => (
                <li key={doc.filename} className="document-row">
                  <span className="document-index" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="document-body">
                    <span className="document-name">{doc.filename}</span>
                    <span className="document-meta">
                      {doc.chunk_count} chunk{doc.chunk_count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="document-actions">
                    <button
                      type="button"
                      className="document-delete"
                      onClick={() => handleDelete(doc.filename)}
                      disabled={deleting === doc.filename}
                      aria-label={`Remove ${doc.filename}`}
                    >
                      {deleting === doc.filename ? "…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="action-rail">
          <span className="action-rail-info">
            {loading ? "—" : `${documents.length} source${documents.length === 1 ? "" : "s"} indexed`}
          </span>
          <label className="action-rail-primary">
            {uploading ? "Uploading…" : "Upload document"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.md"
              onChange={handleUpload}
              disabled={uploading}
              hidden
            />
          </label>
      </div>
    </div>
  );
}
