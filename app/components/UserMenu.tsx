"use client";

import { ChevronsUpDownIcon, LogOutIcon, UserCogIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

// The signed-in user, in the sidebar footer. Account settings live in
// Keycloak's account console (profile, password, sessions) - this only
// links there.
export function UserMenu() {
  const { user, accountUrl, logout } = useAuth();
  const displayName = user.name ?? user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${displayName}`}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-white transition-colors select-none hover:bg-sidebar-accent"
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold"
        >
          {initials(displayName)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{displayName}</span>
          {user.email && <span className="truncate text-xs text-sidebar-foreground/60">{user.email}</span>}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56 p-1.5">
        <DropdownMenuLabel className="truncate">Signed in as {user.username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.open(accountUrl, "_blank", "noopener")}>
          <UserCogIcon className="text-muted-foreground" />
          Manage account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={logout}>
          <LogOutIcon className="text-muted-foreground" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
