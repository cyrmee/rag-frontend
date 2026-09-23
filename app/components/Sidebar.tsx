"use client";

import Image from "next/image";
import Link from "next/link";
import type { ConversationSummary } from "@/lib/api";
import { titleFromQuestion } from "@/lib/conversations";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { FolderOpenIcon, SquarePenIcon, Trash2Icon } from "lucide-react";

// Shared between the chat page (/) and the Sources page (/sources) - each
// page owns its own `history` fetch and decides what "new chat" / "select
// a conversation" actually does (update local state on /, navigate back to
// / with a ?conversation= param from /sources - see app/sources/page.tsx).
export function Sidebar({
  history,
  activeConversationId,
  sourcesActive,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
}: {
  history: ConversationSummary[];
  activeConversationId: string | undefined;
  sourcesActive: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
}) {
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

      <div className="sidebar-scroll mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <p className="px-3 pb-1.5 text-xs font-medium text-sidebar-foreground/55">Recent</p>
        {history.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-sidebar-foreground/55">Nothing here yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {history.map((conv) => {
              const label = conv.title ?? titleFromQuestion(conv.first_question ?? "");
              return (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectConversation(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectConversation(conv.id);
                    }
                  }}
                  className="group/history-row flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-[background-color,transform] duration-150 hover:bg-sidebar-accent active:scale-[0.98] data-[active=true]:bg-[color-mix(in_oklch,var(--brand)_20%,transparent)]"
                  data-active={conv.id === activeConversationId}
                >
                  <span className="min-w-0 flex-1 truncate text-white">{label}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-sidebar-foreground opacity-0 hover:bg-white/15 hover:text-white group-hover/history-row:opacity-100"
                    onClick={(e) => onDeleteConversation(conv.id, e)}
                    aria-label={`Delete ${label}`}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-white/10 pt-2">
        <ThemeToggle />
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
