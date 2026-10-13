"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, FileTextIcon, GlobeIcon } from "lucide-react";
import { cn } from "cn";
import type { ResearchPlan, ResearchProgress as Progress, ResearchStage } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Research mode's stages, in the order the backend runs them (see the
// backend's app/agent.py _research_turn). search -> gaps repeat once per
// round; plan and write happen once.
const STAGES: { stage: ResearchStage; label: string }[] = [
  { stage: "plan", label: "Planning" },
  { stage: "search", label: "Searching the documents" },
  { stage: "read", label: "Reading passages" },
  { stage: "check", label: "Checking notes against passages" },
  { stage: "gaps", label: "Looking for gaps" },
  { stage: "write", label: "Writing the answer" },
];

// Above this many batches a segment per batch gets too thin to read, so
// the bar fills continuously instead.
const MAX_SEGMENTS = 24;

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useElapsed(startedAt: number, finishedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finishedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finishedAt]);
  return (finishedAt ?? now) - startedAt;
}

// The live log of a research-mode turn: which stage it's on, how far
// through reading it is, and what it planned to look for. Once the answer
// has started arriving the log folds into one line, still expandable.
export function ResearchProgress({
  plan,
  progress,
  startedAt,
  finishedAt,
  answering,
  stopped = false,
}: {
  plan?: ResearchPlan;
  progress?: Progress;
  startedAt: number;
  finishedAt?: number;
  answering: boolean;
  // Stopped before it finished: steps it didn't reach stay unticked.
  stopped?: boolean;
}) {
  const elapsed = formatElapsed(useElapsed(startedAt, finishedAt));
  // Open while researching; once the answer arrives it folds away unless
  // the reader opens it again.
  const [expanded, setExpanded] = useState(false);
  const open = !answering || expanded;
  const currentIndex = progress ? STAGES.findIndex((s) => s.stage === progress.stage) : 0;
  const finished = finishedAt !== undefined && !stopped;

  const summary = [
    plan && `${plan.subQuestions.length} question${plan.subQuestions.length === 1 ? "" : "s"}`,
    plan && `${plan.documents.length} document${plan.documents.length === 1 ? "" : "s"} picked`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Collapsible
      open={open}
      onOpenChange={setExpanded}
      className="research-log rounded-xl border border-border bg-card/80 text-xs"
    >
      <CollapsibleTrigger
        disabled={!answering}
        className="group/trigger flex w-full items-center gap-2 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span className="font-heading text-sm font-semibold text-foreground">
          {stopped ? "Research stopped" : finished ? "Researched" : answering ? "Writing from research" : "Researching"}
        </span>
        <span className="text-muted-foreground tabular-nums" aria-label={`Elapsed time ${elapsed}`}>
          {elapsed}
        </span>
        {progress && progress.round > 1 && !answering && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            Round {progress.round}
          </span>
        )}
        {answering && summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
        {answering && (
          <ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/trigger:rotate-180" />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="border-t border-border px-3 pt-3 pb-3">
        <ol className="research-rail flex flex-col gap-2.5" aria-label="Research steps">
          {STAGES.map(({ stage, label }, i) => {
            const state =
              finished || i < currentIndex ? "done" : i === currentIndex && !stopped ? "active" : "pending";
            const showDetail = state === "active" && progress;
            return (
              <li key={stage} data-state={state} className="research-step relative flex gap-2.5 pl-0">
                <span
                  aria-hidden="true"
                  className="research-node relative z-10 mt-px flex size-4 shrink-0 items-center justify-center rounded-full border"
                >
                  {state === "done" && <CheckIcon className="size-2.5" strokeWidth={3} />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span
                    className={cn(
                      "leading-4",
                      state === "pending" ? "text-muted-foreground" : "font-medium text-foreground"
                    )}
                    aria-current={state === "active" ? "step" : undefined}
                  >
                    {label}
                  </span>
                  {showDetail && progress.message && (
                    <span className="text-muted-foreground" aria-live="polite">
                      {progress.message}
                    </span>
                  )}
                  {showDetail && progress.stage === "read" && progress.total ? (
                    <ReadingBar done={progress.done ?? 0} total={progress.total} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {plan && (plan.subQuestions.length > 0 || plan.documents.length > 0) && (
          <div className="mt-3.5 flex flex-col gap-1.5 border-t border-dashed border-border pt-3">
            {plan.subQuestions.length > 0 && (
              <PlanDisclosure label={`What it's looking for (${plan.subQuestions.length})`}>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground marker:text-border">
                  {plan.subQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </PlanDisclosure>
            )}
            {plan.documents.length > 0 && (
              <PlanDisclosure label={`Documents it picked to read (${plan.documents.length})`}>
                <ul className="flex flex-wrap gap-1.5">
                  {plan.documents.map((name) => (
                    <li
                      key={name}
                      className="flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5"
                    >
                      <FileTextIcon className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={name}>
                        {name}
                      </span>
                    </li>
                  ))}
                </ul>
              </PlanDisclosure>
            )}
            {plan.webQueries.length > 0 && (
              <PlanDisclosure label={`Web searches (${plan.webQueries.length})`}>
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {plan.webQueries.map((q, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <GlobeIcon className="size-3 shrink-0" />
                      {q}
                    </li>
                  ))}
                </ul>
              </PlanDisclosure>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReadingBar({ done, total }: { done: number; total: number }) {
  const label = `${done} of ${total} batches read`;
  if (total > MAX_SEGMENTS) {
    return (
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label} className="h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-muted">
        <div className="research-fill h-full rounded-full transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
      </div>
    );
  }
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label} className="flex w-full max-w-72 gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-filled={i < done} className="research-segment h-1.5 flex-1 rounded-[2px]" />
      ))}
    </div>
  );
}

function PlanDisclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/plan flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
        <ChevronDownIcon className="size-3.5 -rotate-90 transition-transform group-aria-expanded/plan:rotate-0" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 pl-[18px]">{children}</CollapsibleContent>
    </Collapsible>
  );
}
