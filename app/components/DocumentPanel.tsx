"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDocument,
  listDocuments,
  uploadDocumentWithProgress,
  type DocumentEntry,
} from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderOpenIcon,
  PresentationIcon,
  RefreshCwIcon,
  SearchIcon,
  SearchXIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";

export const ACCEPTED_TYPES = ".pdf,.docx,.pptx,.xlsx,.txt,.md";
export const ACCEPTED_LABEL = "PDF, Word, PowerPoint, Excel, text, or markdown";

function iconForFilename(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "xlsx":
      return FileSpreadsheetIcon;
    case "pptx":
      return PresentationIcon;
    default:
      return FileTextIcon;
  }
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

type InFlightUpload = {
  id: string;
  file: File;
  progress: number;
  state: "uploading" | "processing" | "error";
  error?: string;
};

export default function DocumentPanel() {
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [inFlight, setInFlight] = useState<InFlightUpload[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removingFilenames, setRemovingFilenames] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setLoading(true);
      setDocuments(await listDocuments());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of an externally-owned list that is also manually refetched after mutations
    refresh();
  }, []);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    const entries: InFlightUpload[] = list.map((file) => ({
      id: makeId(),
      file,
      progress: 0,
      state: "uploading",
    }));
    setInFlight((prev) => [...entries, ...prev]);

    let succeeded = 0;
    let firstError: string | null = null;

    await Promise.all(
      entries.map(async (entry) => {
        try {
          await uploadDocumentWithProgress(entry.file, (percent) => {
            setInFlight((prev) =>
              prev.map((e) =>
                e.id === entry.id
                  ? { ...e, progress: percent, state: percent >= 100 ? "processing" : "uploading" }
                  : e
              )
            );
          });
          succeeded += 1;
          setInFlight((prev) => prev.filter((e) => e.id !== entry.id));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed.";
          firstError ??= message;
          setInFlight((prev) =>
            prev.map((e) => (e.id === entry.id ? { ...e, state: "error", error: message } : e))
          );
        }
      })
    );

    if (fileInputRef.current) fileInputRef.current.value = "";
    await refresh();

    if (succeeded > 0) {
      toast.add({
        title:
          list.length === 1
            ? `${list[0].name} uploaded`
            : `${succeeded} of ${list.length} documents uploaded`,
        type: "success",
      });
    }
    if (firstError) {
      toast.add({
        title: succeeded > 0 ? "Some uploads failed" : "Upload failed",
        description: firstError,
        type: "error",
      });
    }
  }

  function retryUpload(entry: InFlightUpload) {
    setInFlight((prev) => prev.filter((e) => e.id !== entry.id));
    uploadFiles([entry.file]);
  }

  function dismissUpload(id: string) {
    setInFlight((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleUploadInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      await uploadFiles(e.dataTransfer.files);
    }
  }

  async function handleDelete(filename: string) {
    try {
      setDeleting(filename);
      await deleteDocument(filename);
      // Play the exit animation before the row actually disappears from the
      // refreshed list, instead of it vanishing the instant the request
      // resolves.
      setRemovingFilenames((prev) => new Set(prev).add(filename));
      await new Promise((resolve) => setTimeout(resolve, 180));
      await refresh();
      toast.add({ title: `${filename} removed`, type: "success" });
    } catch (err) {
      toast.add({
        title: "Delete failed",
        description: err instanceof Error ? err.message : undefined,
        type: "error",
      });
    } finally {
      setDeleting(null);
      setRemovingFilenames((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    }
  }

  const filteredDocuments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((doc) => doc.filename.toLowerCase().includes(q));
  }, [documents, query]);

  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Documents used to answer your questions.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {loading ? "—" : `${documents.length} source${documents.length === 1 ? "" : "s"} indexed`}
        </span>
      </div>

      <div
        data-active={dragActive}
        className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card px-6 py-10 text-center transition-colors data-[active=true]:border-brand data-[active=true]:bg-[color-mix(in_oklch,var(--brand)_6%,transparent)]"
      >
        <UploadCloudIcon className="size-6 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Drag files here, or choose them yourself
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{ACCEPTED_LABEL}</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<label />}>
          Browse files
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleUploadInput}
            multiple
            hidden
          />
        </Button>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {documents.length > 4 && (
        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter sources…"
            aria-label="Filter sources"
            className="h-9 rounded-full pl-8"
          />
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {inFlight.map((entry) => {
            const Icon = iconForFilename(entry.file.name);
            return (
              <Attachment
                key={entry.id}
                state={entry.state}
                className="w-full animate-in fade-in slide-in-from-bottom-1 duration-200"
              >
                <AttachmentMedia>
                  {entry.state === "error" ? <Icon /> : <Spinner />}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{entry.file.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {entry.state === "uploading" && `Uploading · ${entry.progress}%`}
                    {entry.state === "processing" && "Processing document…"}
                    {entry.state === "error" && (entry.error ?? "Upload failed")}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  {entry.state === "error" ? (
                    <>
                      <AttachmentAction
                        onClick={() => retryUpload(entry)}
                        aria-label={`Retry ${entry.file.name}`}
                      >
                        <RefreshCwIcon />
                      </AttachmentAction>
                      <AttachmentAction
                        onClick={() => dismissUpload(entry.id)}
                        aria-label={`Dismiss ${entry.file.name}`}
                      >
                        <XIcon />
                      </AttachmentAction>
                    </>
                  ) : null}
                </AttachmentActions>
              </Attachment>
            );
          })}

          {documents.length === 0 && inFlight.length === 0 ? (
            <div className="col-span-full">
              <Empty>
                <EmptyMedia variant="icon">
                  <FolderOpenIcon />
                </EmptyMedia>
                <EmptyTitle>No documents ingested yet</EmptyTitle>
                <EmptyDescription>Upload a file to get started.</EmptyDescription>
              </Empty>
            </div>
          ) : filteredDocuments.length === 0 && documents.length > 0 ? (
            <div className="col-span-full">
              <Empty>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>No matches</EmptyTitle>
                <EmptyDescription>
                  Nothing in your sources matches &quot;{query}&quot;.
                </EmptyDescription>
              </Empty>
            </div>
          ) : (
            filteredDocuments.map((doc) => {
              const Icon = iconForFilename(doc.filename);
              const isDeleting = deleting === doc.filename;
              const isRemoving = removingFilenames.has(doc.filename);
              return (
                <Attachment
                  key={doc.filename}
                  state="done"
                  className={
                    isRemoving
                      ? "w-full animate-out fade-out zoom-out-95 duration-180 fill-mode-forwards ease-in"
                      : "w-full animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out"
                  }
                >
                  <AttachmentMedia>
                    <Icon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{doc.filename}</AttachmentTitle>
                    <AttachmentDescription>
                      {doc.chunk_count} chunk{doc.chunk_count === 1 ? "" : "s"}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      onClick={() => handleDelete(doc.filename)}
                      disabled={isDeleting}
                      aria-label={`Remove ${doc.filename}`}
                    >
                      {isDeleting ? <Spinner /> : <XIcon />}
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
