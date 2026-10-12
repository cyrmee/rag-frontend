"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  ChevronsUpDownIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserCogIcon,
} from "lucide-react";
import { cn } from "cn";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = {
  light: { label: "Light", icon: SunIcon },
  dark: { label: "Dark", icon: MoonIcon },
  system: { label: "System", icon: MonitorIcon },
} as const;

type ThemeValue = keyof typeof THEMES;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

function UserAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold", className)}
    >
      {initials(name)}
    </span>
  );
}

// The signed-in user, in the sidebar footer. Its menu holds everything
// about the account and this browser: who is signed in, a link to
// Keycloak's account console (profile, password, sessions), the theme,
// and signing out.
export function UserMenu() {
  const { user, accountUrl, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored theme after mount - avoid a
  // hydration mismatch by showing "system" until then.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const currentTheme: ThemeValue = mounted ? ((theme as ThemeValue) ?? "system") : "system";

  const displayName = user.name ?? user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account and settings: ${displayName}`}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-white transition-colors select-none hover:bg-sidebar-accent"
      >
        <UserAvatar name={displayName} className="size-7 bg-white/15 text-[11px]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{displayName}</span>
          {user.email && <span className="truncate text-xs text-sidebar-foreground/60">{user.email}</span>}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64 p-1.5">
        <div className="flex items-center gap-3 px-2 py-2">
          <UserAvatar name={displayName} className="size-10 bg-brand/15 text-sm text-foreground" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
            {user.email && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
            {user.name && <span className="truncate text-xs text-muted-foreground">@{user.username}</span>}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.open(accountUrl, "_blank", "noopener")}>
          <UserCogIcon className="text-muted-foreground" />
          Manage account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={currentTheme} onValueChange={setTheme}>
          <DropdownMenuLabel className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Theme
          </DropdownMenuLabel>
          {(Object.keys(THEMES) as ThemeValue[]).map((value) => {
            const ItemIcon = THEMES[value].icon;
            return (
              <DropdownMenuRadioItem key={value} value={value}>
                <ItemIcon className="text-muted-foreground" />
                {THEMES[value].label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOutIcon className="text-muted-foreground" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
