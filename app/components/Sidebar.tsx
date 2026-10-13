"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ConversationSummary } from "@/lib/api";
import { titleFromQuestion } from "@/lib/conversations";
import type { ConversationHistory } from "@/lib/use-conversation-history";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { UserMenu } from "@/app/components/UserMenu";
import { FolderOpenIcon, PencilIcon, SearchIcon, SquarePenIcon, Trash2Icon, XIcon } from "lucide-react";

// Shared between the chat page (/) and the Sources page (/sources). Each
// page owns its history (useConversationHistory) and decides what "new
// chat" / "select a conversation" do (update local state on /, navigate
// back to / with a ?conversation= param from /sources). `onDeleted` lets
// the chat page clear a conversation that was open when it was deleted.
export function Sidebar({
  history,
  activeConversationId,
  sourcesActive,
  onNewConversation,
  onSelectConversation,
  onDeleted,
}: {
  history: ConversationHistory;
  activeConversationId: string | undefined;
  sourcesActive: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleted?: (id: string) => void;
}) {
  // Deleting takes two clicks: the trash button turns into "Delete", and
  // only that deletes. Moving away or tabbing off cancels it.
  const [armedId, setArmedId] = useState<string | null>(null);
  // The conversation whose title is being edited in place, and its draft.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const { conversations, query } = history;

  function startRename(conv: ConversationSummary, label: string) {
    setArmedId(null);
    setRenamingId(conv.id);
    setDraftTitle(conv.title ?? label);
  }

  function finishRename(save: boolean) {
    if (save && renamingId && draftTitle.trim()) history.rename(renamingId, draftTitle);
    setRenamingId(null);
  }

  return (
    <div className="bg-sidebar-gradient flex h-full w-full flex-col p-2 text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <Image
          src="/fayda-logo.png"
          alt=""
          aria-hidden="true"
          width={22}
          height={22}
          className="rounded-full"
        />
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-white">
          Fayda አንባቢ
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
        </span>
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        <SidebarItem icon={SquarePenIcon} label="New chat" onClick={onNewConversation} />
        <SidebarItem icon={FolderOpenIcon} label="Sources" href="/sources" active={sourcesActive} />
      </div>

      <nav aria-label="Conversations" className="sidebar-scroll mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="relative mb-2 px-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-sidebar-foreground/55" />
          <input
            type="search"
            value={query}
            onChange={(e) => history.setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            maxLength={200}
            className="h-8 w-full rounded-lg border border-white/10 bg-white/8 pr-7 pl-8 text-sm text-white outline-none placeholder:text-sidebar-foreground/55 focus-visible:border-brand/70 focus-visible:ring-2 focus-visible:ring-brand/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {history.loading && query ? (
            <Spinner className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-sidebar-foreground/70" />
          ) : query ? (
            <button
              type="button"
              onClick={() => history.setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/70 hover:bg-white/15 hover:text-white"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>

        {conversations.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-sidebar-foreground/55">
            {history.loading
              ? "Loading…"
              : query
                ? "No conversation title or question matches."
                : "Conversations you start appear here."}
          </p>
        ) : (
          groupByRecency(conversations).map(({ label: groupLabel, conversations: group }) => (
            <section key={groupLabel} aria-label={groupLabel} className="mb-3 flex flex-col gap-0.5">
              <h2 className="px-3 pb-1 font-sans text-xs font-medium text-sidebar-foreground/55">{groupLabel}</h2>
              {group.map((conv) => {
                const label = conv.title ?? titleFromQuestion(conv.first_question ?? "");
                const armed = armedId === conv.id;
                if (renamingId === conv.id) {
                  return (
                    <input
                      key={conv.id}
                      autoFocus
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => finishRename(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") finishRename(true);
                        if (e.key === "Escape") finishRename(false);
                      }}
                      maxLength={200}
                      aria-label="Conversation title"
                      className="h-9 w-full rounded-xl border border-brand/70 bg-white/10 px-3 text-sm text-white outline-none"
                    />
                  );
                }
                return (
                  <div
                    key={conv.id}
                    onMouseLeave={() => armed && setArmedId(null)}
                    className="group/history-row flex items-center gap-0.5 rounded-xl pr-1.5 transition-colors duration-150 hover:bg-sidebar-accent has-[button:focus-visible]:bg-sidebar-accent data-[active=true]:bg-[color-mix(in_oklch,var(--brand)_20%,transparent)]"
                    data-active={conv.id === activeConversationId}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectConversation(conv.id)}
                      onDoubleClick={() => startRename(conv, label)}
                      aria-current={conv.id === activeConversationId ? "page" : undefined}
                      title={label}
                      className="min-w-0 flex-1 truncate rounded-xl py-2 pl-3 text-left text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-brand/70 active:scale-[0.98]"
                    >
                      {label}
                    </button>
                    {armed ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        autoFocus
                        className="shrink-0 bg-white/15 text-white hover:bg-fayda-red hover:text-white focus-visible:bg-fayda-red"
                        onClick={() => {
                          setArmedId(null);
                          history.remove(conv.id);
                          onDeleted?.(conv.id);
                        }}
                        onBlur={() => setArmedId(null)}
                        aria-label={`Confirm deleting ${label}`}
                      >
                        Delete
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-sidebar-foreground opacity-0 group-hover/history-row:opacity-100 hover:bg-white/15 hover:text-white focus-visible:opacity-100 touch:opacity-70"
                          onClick={() => startRename(conv, label)}
                          aria-label={`Rename ${label}`}
                          title="Rename"
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-sidebar-foreground opacity-0 group-hover/history-row:opacity-100 hover:bg-white/15 hover:text-white focus-visible:opacity-100 touch:opacity-70"
                          onClick={() => {
                            setRenamingId(null);
                            setArmedId(conv.id);
                          }}
                          aria-label={`Delete ${label}`}
                          title="Delete conversation"
                        >
                          <Trash2Icon />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}

        {history.hasMore && (
          <button
            type="button"
            onClick={history.loadMore}
            disabled={history.loadingMore}
            className="mx-1 mb-2 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-white disabled:opacity-60"
          >
            {history.loadingMore && <Spinner className="size-3.5" />}
            Show older conversations
          </button>
        )}
      </nav>

      <div className="mt-2 border-t border-white/10 pt-2 pb-[env(safe-area-inset-bottom)]">
        <UserMenu />
      </div>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  onClick,
  href,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  href?: string;
  active?: boolean;
}) {
  const className =
    "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-white transition-[background-color,transform] duration-150 hover:bg-sidebar-accent active:scale-[0.98] data-[active=true]:bg-[color-mix(in_oklch,var(--brand)_20%,transparent)]";
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-sidebar-foreground/70" />
      {label}
    </>
  );
  if (href) {
    return (
      <Link href={href} data-active={active} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} data-active={active} className={className}>
      {content}
    </button>
  );
}

// Buckets conversations by when they were last updated, newest first
// (the backend already returns them in that order).
function groupByRecency(history: ConversationSummary[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const buckets: { label: string; after: number }[] = [
    { label: "Today", after: startOfToday.getTime() },
    { label: "Yesterday", after: startOfToday.getTime() - day },
    { label: "Previous 7 days", after: startOfToday.getTime() - 7 * day },
    { label: "Previous 30 days", after: startOfToday.getTime() - 30 * day },
    { label: "Older", after: -Infinity },
  ];
  const groups: { label: string; conversations: ConversationSummary[] }[] = [];
  for (const conv of history) {
    const updated = Date.parse(conv.updated_at);
    const bucket = buckets.find((b) => updated >= b.after) ?? buckets[buckets.length - 1];
    const group = groups.find((g) => g.label === bucket.label);
    if (group) group.conversations.push(conv);
    else groups.push({ label: bucket.label, conversations: [conv] });
  }
  return groups;
}
