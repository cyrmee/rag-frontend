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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

const ACCEPTED_TYPES = ".pdf,.docx,.pptx,.xlsx,.txt,.md";
const ACCEPTED_LABEL = "PDF, Word, PowerPoint, Excel, text, or markdown";

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
    }
  }

  const filteredDocuments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((doc) => doc.filename.toLowerCase().includes(q));
  }, [documents, query]);

  return (
    <Card
      className="relative h-full min-h-0 gap-0 overflow-hidden py-0"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CardHeader className="border-b border-border py-3.5">
        <CardTitle>Sources</CardTitle>
        <CardDescription>
          Documents used to answer your questions — drop files anywhere to upload.
        </CardDescription>
      </CardHeader>

      {documents.length > 4 && (
        <div className="p-2.5">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter sources…"
              aria-label="Filter sources"
              className="h-8 rounded-full pl-8"
            />
          </div>
        </div>
      )}

      <CardContent className="min-h-0 flex-1 overflow-y-auto p-3">
        {loadError && (
          <Alert variant="destructive" className="mb-3">
            <TriangleAlertIcon />
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
              <Empty className="h-full">
                <EmptyMedia variant="icon">
                  <FolderOpenIcon />
                </EmptyMedia>
                <EmptyTitle>No documents ingested yet</EmptyTitle>
                <EmptyDescription>
                  Upload a file, or drop it anywhere in this panel.
                </EmptyDescription>
              </Empty>
            ) : filteredDocuments.length === 0 && documents.length > 0 ? (
              <Empty className="h-full">
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>No matches</EmptyTitle>
                <EmptyDescription>
                  Nothing in your sources matches &quot;{query}&quot;.
                </EmptyDescription>
              </Empty>
            ) : (
              filteredDocuments.map((doc) => {
                const Icon = iconForFilename(doc.filename);
                const isDeleting = deleting === doc.filename;
                return (
                  <Attachment
                    key={doc.filename}
                    state="done"
                    className="w-full animate-in fade-in slide-in-from-bottom-1 duration-200"
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
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-1.5 border-t bg-transparent px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {loading ? "—" : `${documents.length} source${documents.length === 1 ? "" : "s"} indexed`}
          </span>
          <Button variant="default" size="sm" nativeButton={false} render={<label />}>
            Upload
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
        <span className="px-1 text-[11px] text-muted-foreground">{ACCEPTED_LABEL}</span>
      </CardFooter>

      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/90">
          <UploadCloudIcon className="size-6 text-primary" />
          <p className="text-sm font-medium text-foreground">Drop to upload</p>
        </div>
      )}
    </Card>
  );
}
