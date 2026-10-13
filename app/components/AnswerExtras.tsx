"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChartColumnIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  ExternalLinkIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  PresentationIcon,
  ShieldAlertIcon,
} from "lucide-react";
import type { AskSource, CitationWarning } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { splitPath } from "@/lib/utils";
import { useSourceFocus } from "@/lib/source-focus";

// page_number means something different per format: a real page (pdf), a
// slide (pptx), a sheet order index (xlsx), or a synthetic paragraph/table
// index (docx, which has no true page concept) - null for txt/md.
function formatUnit(sourceFormat: string | undefined, pageNumber: number | null | undefined): string {
  if (pageNumber == null) return "";
  switch (sourceFormat) {
    case "pdf":
      return `page ${pageNumber}`;
    case "pptx":
      return `slide ${pageNumber}`;
    case "xlsx":
      return `sheet ${pageNumber}`;
    case "docx":
      return `part ${pageNumber}`;
    default:
      return String(pageNumber);
  }
}

// A web result's `filename` is the page title and its document_url the
// page itself; everything else is a file from Sources.
function hostnameOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function iconFor(source: AskSource) {
  if (source.source_type === "web") return GlobeIcon;
  if (source.source_type === "image_caption") return ImageIcon;
  if (source.source_type === "chart_data") return ChartColumnIcon;
  if (source.source_format === "xlsx") return FileSpreadsheetIcon;
  if (source.source_format === "pptx") return PresentationIcon;
  return FileTextIcon;
}

// What kind of passage it is, when it isn't plain text from the document.
function kindOf(source: AskSource): string {
  if (source.source_type === "image_caption") return "figure";
  if (source.source_type === "chart_data") return "chart data";
  return "";
}

const SUMMARY_NAMES = 2;

// Collapsed, the trigger previews which documents the answer drew on;
// expanded, each numbered source (the [N] in the answer) opens to the
// passage itself, with a link to the original file or web page.
export function SourceList({ sources, messageId }: { sources: AskSource[]; messageId: string }) {
  const [open, setOpen] = useState(false);
  // Which sources show their passage (1-based, as numbered).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // The source a citation click just opened, highlighted for a moment.
  const [focused, setFocused] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const handleFocus = useCallback((index: number) => {
    setOpen(true);
    setExpanded((prev) => new Set(prev).add(index));
    setFocused(index);
  }, []);
  useSourceFocus(messageId, handleFocus);

  // Scrolls once the list has opened and rendered the source.
  useEffect(() => {
    if (focused === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${focused}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    row?.querySelector("summary")?.focus({ preventScroll: true });
    const timer = setTimeout(() => setFocused(null), 1600);
    return () => clearTimeout(timer);
  }, [focused]);

  const names = [
    ...new Set(sources.map((s) => (s.filename ? splitPath(s.filename).name : "")).filter(Boolean)),
  ];
  const preview = names.slice(0, SUMMARY_NAMES).join(", ");
  const more = names.length - SUMMARY_NAMES;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group/trigger flex max-w-full min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-aria-expanded/trigger:rotate-180" />
        <span className="shrink-0 font-medium">Sources ({sources.length})</span>
        {preview && (
          <span className="min-w-0 truncate group-aria-expanded/trigger:hidden">
            {" "}
            from {preview}
            {more > 0 && ` and ${more} more`}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol ref={listRef} className="mt-1.5 flex flex-col overflow-hidden rounded-lg border border-border bg-card/60">
          {sources.map((source, i) => {
            const Icon = iconFor(source);
            const isWeb = source.source_type === "web";
            const title = source.filename ?? "Untitled source";
            const { name, folder } = isWeb ? { name: title, folder: "" } : splitPath(title);
            const detail = [kindOf(source), isWeb ? hostnameOf(source.document_url) : formatUnit(source.source_format, source.page_number)]
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={`${messageId}-${i}`}
                id={`source-${messageId}-${i + 1}`}
                data-index={i + 1}
                data-focused={focused === i + 1}
                className="scroll-mt-4 border-b border-border transition-colors duration-500 last:border-b-0 data-[focused=true]:bg-[color-mix(in_oklch,var(--brand)_16%,transparent)]"
              >
                <details
                  className="group/source"
                  open={expanded.has(i + 1)}
                  onToggle={(e) => {
                    const isOpen = e.currentTarget.open;
                    setExpanded((prev) => {
                      if (prev.has(i + 1) === isOpen) return prev;
                      const next = new Set(prev);
                      if (isOpen) next.add(i + 1);
                      else next.delete(i + 1);
                      return next;
                    });
                  }}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                    <span className="w-4 shrink-0 text-right font-semibold tabular-nums" style={{ color: "var(--color-grounded-fg)" }}>
                      {i + 1}
                    </span>
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground" title={title}>
                      {name}
                    </span>
                    {detail && <span className="shrink-0 text-muted-foreground">{detail}</span>}
                    <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/source:rotate-180" />
                  </summary>
                  <div className="flex flex-col gap-2 px-2.5 pb-2.5 pl-[34px]">
                    {folder && <span className="text-[11px] break-words text-muted-foreground/80">{folder}</span>}
                    {source.content && (
                      <p className="line-clamp-[8] text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
                        {source.content}
                      </p>
                    )}
                    {source.document_url && (
                      <a
                        href={source.document_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex w-fit items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline dark:text-fayda-sky"
                      >
                        <ExternalLinkIcon className="size-3" />
                        {isWeb ? "Open web page" : "Open document"}
                      </a>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Charts carry their own unconfirmed-values note (components/answer-chart.tsx),
// so their warnings aren't repeated here.
export function textWarnings(warnings: CitationWarning[] | undefined): CitationWarning[] {
  return (warnings ?? []).filter((w) => !w.reason.startsWith("chart values"));
}

// A flagged segment is a line of the answer's markdown ("   - *Metrics*: ...");
// quoted on its own, the list marker and emphasis are noise.
function plainText(markdown: string): string {
  return markdown
    .trim()
    .replace(/^(?:[-*+]|\d+\.)\s+/, "")
    .replace(/[*_`]+/g, "");
}

// Sentences the citation check couldn't confirm against the sources they
// cite - worth reading the sources before relying on them.
export function CitationWarnings({ warnings }: { warnings: CitationWarning[] }) {
  if (warnings.length === 0) return null;
  const count = warnings.length;
  return (
    <Collapsible
      className="rounded-lg border text-xs"
      style={{
        borderColor: "var(--color-pending-border)",
        background: "var(--color-pending-bg)",
        color: "var(--color-pending-fg)",
      }}
    >
      <CollapsibleTrigger className="group/trigger flex w-full items-center gap-1.5 px-2.5 py-2 text-left font-medium">
        <ShieldAlertIcon className="size-3.5 shrink-0" />
        <span className="flex-1">
          {count === 1 ? "1 statement isn't backed" : `${count} statements aren't backed`} by the sources it cites
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-aria-expanded/trigger:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-2 px-2.5 pb-2.5">
          {warnings.map((w, i) => (
            <li key={i} className="flex flex-col gap-0.5 border-l-2 pl-2" style={{ borderColor: "var(--color-pending-border)" }}>
              <span className="text-foreground">“{plainText(w.text)}”</span>
              {w.reason && <span>{w.reason.charAt(0).toUpperCase() + w.reason.slice(1)}.</span>}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Research mode: the parts of the question the documents didn't answer.
export function NotFound({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <CircleHelpIcon className="size-3.5 shrink-0 text-muted-foreground" />
        The documents didn&apos;t answer
      </span>
      <ul className="flex list-disc flex-col gap-0.5 pl-9 text-muted-foreground marker:text-border">
        {questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </div>
  );
}
