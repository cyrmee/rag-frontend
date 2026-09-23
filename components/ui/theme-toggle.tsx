"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { ChevronDownIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { cn } from "cn"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const THEME_META = {
  light: { label: "Light", icon: SunIcon },
  dark: { label: "Dark", icon: MoonIcon },
  system: { label: "System", icon: MonitorIcon },
} as const

type ThemeValue = keyof typeof THEME_META

function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  // Avoid a hydration mismatch: next-themes only knows the real value
  // (from localStorage / prefers-color-scheme) after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const current: ThemeValue = mounted ? ((theme as ThemeValue) ?? "system") : "system"
  const { label, icon: Icon } = THEME_META[current]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="theme-trigger"
        aria-label={`Theme: ${label}`}
        className={cn(
          "flex h-9 w-full min-w-0 cursor-pointer items-center justify-between rounded-xl border border-white/15 bg-white/10 px-2.5 text-white shadow-xs backdrop-blur-xs transition-all select-none hover:bg-white/15",
          className
        )}
      >
        <span className="flex items-center gap-2 text-sm">
          <Icon className="size-4" />
          {label}
        </span>
        <ChevronDownIcon className="size-4 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-36 p-1.5">
        <DropdownMenuRadioGroup value={current} onValueChange={setTheme}>
          <DropdownMenuLabel className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Theme
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.keys(THEME_META) as ThemeValue[]).map((value) => {
            const ItemIcon = THEME_META[value].icon
            return (
              <DropdownMenuRadioItem key={value} value={value} className="text-xs">
                <ItemIcon className="text-muted-foreground" />
                {THEME_META[value].label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ThemeToggle }
