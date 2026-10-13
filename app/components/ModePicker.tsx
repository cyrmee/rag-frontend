"use client";

import { ChevronDownIcon, CompassIcon, LibraryBigIcon, ListChecksIcon, ZapIcon } from "lucide-react";
import type { AnsweredMode, AskMode } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";

// User-facing names for the backend's answer modes (AskRequest.mode):
// agent -> Quick, council -> Thorough, research -> Research. "auto" sends
// no mode and lets the backend route each question.
export const MODES: Record<
  AskMode,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  auto: {
    label: "Auto",
    description: "Picks Quick or Thorough for each question.",
    icon: CompassIcon,
  },
  agent: {
    label: "Quick",
    description: "Searches until it finds the answer. Best for a fact or two.",
    icon: ZapIcon,
  },
  council: {
    label: "Thorough",
    description: "Searches from several angles at once, then checks each citation. Best for summaries and comparisons.",
    icon: ListChecksIcon,
  },
  research: {
    label: "Research",
    description: "Breaks the question down and reads across many documents in rounds. Takes a few minutes.",
    icon: LibraryBigIcon,
  },
};

export const ANSWERED_LABELS: Record<AnsweredMode, string> = {
  agent: "Quick answer",
  council: "Thorough answer",
  research: "Research answer",
};

const ORDER: AskMode[] = ["auto", "agent", "council", "research"];

const MODE_STORAGE_KEY = "anbabi.mode";

// The last mode picked is remembered in this browser only - a per-viewer
// convenience. Storage can be missing or throw (private windows, blocked
// site data), in which case every visit starts on Auto.
export function loadStoredMode(): AskMode {
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (stored && stored in MODES) return stored as AskMode;
  } catch {
    // ignore
  }
  return "auto";
}

export function storeMode(mode: AskMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function ModePicker({
  value,
  onChange,
  disabled,
}: {
  value: AskMode;
  onChange: (mode: AskMode) => void;
  disabled?: boolean;
}) {
  const Current = MODES[value].icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <InputGroupButton
            variant={value === "auto" ? "ghost" : "outline"}
            size="sm"
            aria-label={`Answer mode: ${MODES[value].label}`}
            className="gap-1.5 data-[mode=research]:border-brand data-[mode=research]:bg-[color-mix(in_oklch,var(--brand)_14%,transparent)]"
            data-mode={value}
          />
        }
      >
        <Current data-icon="inline-start" />
        <span>{MODES[value].label}</span>
        <ChevronDownIcon className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
            How should it answer?
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as AskMode)}>
            {ORDER.map((mode) => {
              const { label, description, icon: Icon } = MODES[mode];
              return (
                <DropdownMenuRadioItem key={mode} value={mode} className="items-start gap-2.5 py-2 pr-8">
                  <Icon className="mt-0.5 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{label}</span>
                    <span className="text-xs leading-snug whitespace-normal text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
