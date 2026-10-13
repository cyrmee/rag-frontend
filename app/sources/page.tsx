"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DocumentPanel from "@/app/components/DocumentPanel";
import { Sidebar } from "@/app/components/Sidebar";
import { useConversationHistory } from "@/lib/use-conversation-history";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MenuIcon } from "lucide-react";

export default function SourcesPage() {
  const router = useRouter();
  const history = useConversationHistory();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // The chat UI only exists on / - both of these leave this page for
  // there, either to a blank composer or with ?conversation= set so the
  // chat page's mount effect knows which one to open (see Chat.tsx).
  const sidebarProps = {
    history,
    activeConversationId: undefined,
    sourcesActive: true,
    onNewConversation: () => router.push("/"),
    onSelectConversation: (id: string) => router.push(`/?conversation=${id}`),
  };

  return (
    <div className="bg-page-gradient flex h-dvh w-full overflow-hidden">
      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border lg:flex">
        <Sidebar {...sidebarProps} />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-72 gap-0 border-sidebar-border p-0 [&_[data-slot=sheet-close]]:text-white [&_[data-slot=sheet-close]]:hover:bg-white/15"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <Sidebar {...sidebarProps} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon />
          </Button>
          <span className="text-sm font-semibold tracking-tight text-foreground">Sources</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DocumentPanel />
        </div>
      </div>
    </div>
  );
}
