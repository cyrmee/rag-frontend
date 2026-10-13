"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteDocument,
  listDocuments,
  listFolders,
  uploadDocumentWithProgress,
  type DocumentPage,
  type DocumentType,
  type FolderEntry,
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
import { splitPath } from "@/lib/utils";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
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

const PAGE_SIZE = 60;
// How long typing pauses before the search goes to the server.
const SEARCH_DELAY_MS = 300;

const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  xlsx: "Excel",
  txt: "Text",
  md: "Markdown",
};

function formatLabel(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FORMAT_LABELS[ext] ?? ext.toUpperCase();
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
  // The page on screen. The backend searches and pages (GET /documents),
  // since Sources holds thousands of files.
  const [page, setPage] = useState<DocumentPage | null>(null);
  // The search the page was fetched for - `query` is the box as typed,
  // `searchTerm` the same once typing pauses.
  const [searchTerm, setSearchTerm] = useState("");
  const [offset, setOffset] = useState(0);
  // The folder being browsed ("" for the whole library) and the file type
  // shown (undefined for every type). Documents listed are everything
  // under the folder, at any depth.
  const [folder, setFolder] = useState("");
  const [fileType, setFileType] = useState<DocumentType | undefined>(undefined);
  // The folders directly inside `folder`; null when the backend can't list
  // folders, which leaves browsing out.
  const [folders, setFolders] = useState<FolderEntry[] | null>([]);
  const [fetching, setFetching] = useState(true);
  // Typing fast sends several searches; only the latest one's answer counts.
  const latestRequest = useRef(0);
  const listTopRef = useRef<HTMLDivElement>(null);
  const [inFlight, setInFlight] = useState<InFlightUpload[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Sources is one corpus shared by everyone, so removing a document takes
  // a second click: the first arms it and says what will happen.
  const [armed, setArmed] = useState<string | null>(null);
  const [removingFilenames, setRemovingFilenames] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load(term: string, from: number) {
    const request = ++latestRequest.current;
    setFetching(true);
    try {
      const next = await listDocuments({ q: term, limit: PAGE_SIZE, offset: from, folder, type: fileType });
      if (request !== latestRequest.current) return;
      // Deleting the last document on the last page leaves it empty -
      // step back to the page before instead of showing nothing.
      if (next.documents.length === 0 && from > 0 && next.total > 0) {
        setOffset(Math.max(0, Math.floor((next.total - 1) / PAGE_SIZE) * PAGE_SIZE));
        return;
      }
      setPage(next);
      setLoadError(null);
    } catch (err) {
      if (request !== latestRequest.current) return;
      setLoadError(err instanceof Error ? err.message : "Could not load documents.");
    } finally {
      if (request === latestRequest.current) setFetching(false);
    }
  }

  // Refetches the page on screen, after an upload or a delete.
  async function refresh() {
    await load(searchTerm, offset);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the externally-owned page for the current search, filters and offset
    load(searchTerm, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads folder and fileType, listed here
  }, [searchTerm, offset, folder, fileType]);

  useEffect(() => {
    let cancelled = false;
    listFolders(folder)
      .then((next) => !cancelled && setFolders(next))
      .catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, [folder]);

  function openFolder(path: string) {
    setFolder(path);
    setOffset(0);
  }

  function chooseType(next: DocumentType | undefined) {
    setFileType(next);
    setOffset(0);
  }

  useEffect(() => {
    if (query.trim() === searchTerm) return;
    const timer = setTimeout(() => {
      setSearchTerm(query.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, searchTerm]);

  function goToOffset(next: number) {
    setOffset(next);
    listTopRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

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
    setArmed(null);
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

  const documents = page?.documents ?? [];
  const total = page?.total ?? 0;
  const loading = page === null && fetching;
  const filtered = Boolean(searchTerm || folder || fileType);
  // Nothing uploaded at all, as opposed to a search or filter with no matches.
  const corpusEmpty = page !== null && total === 0 && !filtered;
  const crumbs = folder ? folder.split("/") : [];

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
            Every answer is drawn from these documents. Everyone who signs in shares them.
          </p>
        </div>
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

      {!corpusEmpty && (
        <div ref={listTopRef} className="flex scroll-mt-4 flex-col gap-3">
          {folders !== null && (
            <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => openFolder("")}
                aria-current={folder === "" ? "page" : undefined}
                className="rounded-md px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:text-foreground"
              >
                All sources
              </button>
              {crumbs.map((name, i) => {
                const path = crumbs.slice(0, i + 1).join("/");
                const current = i === crumbs.length - 1;
                return (
                  <span key={path} className="flex min-w-0 items-center gap-1">
                    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => openFolder(path)}
                      aria-current={current ? "page" : undefined}
                      className="max-w-48 truncate rounded-md px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:text-foreground"
                      title={path}
                    >
                      {name}
                    </button>
                  </span>
                );
              })}
            </nav>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-sm">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={folder ? `Search in ${crumbs[crumbs.length - 1]}…` : "Search by file or folder name…"}
                aria-label="Search sources"
                maxLength={200}
                className="h-9 pr-8 pl-8"
              />
              {fetching && page !== null && (
                <Spinner className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
            {page !== null && total > 0 && (
              <Pager offset={page.offset} shown={documents.length} total={total} disabled={fetching} onGo={goToOffset} />
            )}
          </div>

          <div role="radiogroup" aria-label="File type" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
            {([undefined, "pdf", "docx", "pptx", "xlsx", "txt", "md"] as const).map((type) => {
              const selected = fileType === type;
              return (
                <button
                  key={type ?? "all"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => chooseType(type)}
                  className="shrink-0 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground"
                >
                  {type ? FORMAT_LABELS[type] : "All types"}
                </button>
              );
            })}
          </div>

          {folders !== null && folders.length > 0 && !searchTerm && (
            <ul aria-label="Folders" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {folders.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => openFolder(f.path)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <FolderIcon className="size-4 shrink-0 text-primary dark:text-fayda-sky" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={f.name}>
                      {f.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {f.document_count.toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {folder && page !== null && total > 0 && (
            <p className="text-xs text-muted-foreground">
              Documents in {crumbs[crumbs.length - 1]} and its subfolders
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (
        <div
          aria-busy={fetching}
          className="grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 xl:grid-cols-3 aria-busy:opacity-60"
        >
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
                    {entry.state === "processing" && "Reading the document. Large files with images take a few minutes."}
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

          {corpusEmpty && inFlight.length === 0 ? (
            <div className="col-span-full">
              <Empty>
                <EmptyMedia variant="icon">
                  <FolderOpenIcon />
                </EmptyMedia>
                <EmptyTitle>No documents yet</EmptyTitle>
                <EmptyDescription>Add a file above and questions will be answered from it.</EmptyDescription>
              </Empty>
            </div>
          ) : page !== null && total === 0 && filtered ? (
            <div className="col-span-full">
              <Empty>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>No matches</EmptyTitle>
                <EmptyDescription>
                  {searchTerm
                    ? <>No file or folder name contains &ldquo;{searchTerm}&rdquo;{folder || fileType ? " with these filters" : ""}.</>
                    : "No documents of this type here."}
                </EmptyDescription>
              </Empty>
            </div>
          ) : (
            documents.map((doc) => {
              const Icon = iconForFilename(doc.filename);
              const isDeleting = deleting === doc.filename;
              const isArmed = armed === doc.filename;
              const isRemoving = removingFilenames.has(doc.filename);
              return (
                <Attachment
                  key={doc.filename}
                  state="done"
                  onMouseLeave={() => isArmed && setArmed(null)}
                  className={
                    isRemoving
                      ? "w-full animate-out fade-out zoom-out-95 duration-180 fill-mode-forwards ease-in"
                      : isArmed
                        ? "w-full border-destructive/40"
                        : "w-full"
                  }
                >
                  <AttachmentMedia>
                    <Icon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle title={doc.filename}>{splitPath(doc.filename).name}</AttachmentTitle>
                    <AttachmentDescription className={isArmed ? "text-destructive" : undefined}>
                      {isArmed
                        ? "Remove for everyone?"
                        : `${formatLabel(doc.filename)}, ${doc.chunk_count.toLocaleString()} passage${doc.chunk_count === 1 ? "" : "s"}${splitPath(doc.filename).folder ? ` in ${splitPath(doc.filename).folder}` : ""}`}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    {isArmed ? (
                      <>
                        <AttachmentAction
                          variant="destructive"
                          autoFocus
                          onClick={() => handleDelete(doc.filename)}
                          aria-label={`Confirm removing ${doc.filename} from Sources`}
                        >
                          <CheckIcon />
                        </AttachmentAction>
                        <AttachmentAction onClick={() => setArmed(null)} aria-label="Keep it">
                          <XIcon />
                        </AttachmentAction>
                      </>
                    ) : (
                      <AttachmentAction
                        onClick={() => setArmed(doc.filename)}
                        disabled={isDeleting}
                        aria-label={`Remove ${doc.filename}`}
                        title="Remove from Sources"
                      >
                        {isDeleting ? <Spinner /> : <XIcon />}
                      </AttachmentAction>
                    )}
                  </AttachmentActions>
                </Attachment>
              );
            })
          )}
        </div>
      )}

      {page !== null && total > documents.length && (
        <div className="flex justify-center pb-4">
          <Pager offset={page.offset} shown={documents.length} total={total} disabled={fetching} onGo={goToOffset} />
        </div>
      )}
    </div>
  );
}

// "61–120 of 4,819" with previous/next page buttons.
function Pager({
  offset,
  shown,
  total,
  disabled,
  onGo,
}: {
  offset: number;
  shown: number;
  total: number;
  disabled: boolean;
  onGo: (offset: number) => void;
}) {
  const first = shown === 0 ? 0 : offset + 1;
  const last = offset + shown;
  return (
    <nav aria-label="Pages" className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="mr-1 tabular-nums" aria-live="polite">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => onGo(Math.max(0, offset - PAGE_SIZE))}
        disabled={disabled || offset === 0}
        aria-label="Previous page"
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => onGo(offset + PAGE_SIZE)}
        disabled={disabled || last >= total}
        aria-label="Next page"
      >
        <ChevronRightIcon />
      </Button>
    </nav>
  );
}
