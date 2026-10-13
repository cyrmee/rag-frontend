"use client";

import { useEffect } from "react";

// Clicking a citation number in an answer opens that source in the list
// under the same answer. The two are far apart in the tree (the number is
// inside rendered markdown or a chart), so they talk through a window
// event keyed by the answer's message id.
const EVENT = "anbabi:focus-source";

type Detail = { messageId: string; index: number };

// `index` is the citation number: 1-based, as shown in the answer.
export function focusSource(messageId: string, index: number) {
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { messageId, index } }));
}

export function useSourceFocus(messageId: string, onFocus: (index: number) => void) {
  useEffect(() => {
    function handle(event: Event) {
      const { detail } = event as CustomEvent<Detail>;
      if (detail.messageId === messageId) onFocus(detail.index);
    }
    window.addEventListener(EVENT, handle);
    return () => window.removeEventListener(EVENT, handle);
  }, [messageId, onFocus]);
}

// Citation links in an answer's markdown point here rather than at the
// file, so they stay in the conversation (see Chat.tsx).
export function sourceHref(messageId: string, index: number): string {
  return `#source-${messageId}-${index}`;
}

export function parseSourceHref(href: string | undefined): Detail | null {
  const match = href?.match(/^#source-(.+)-(\d+)$/);
  return match ? { messageId: match[1], index: Number(match[2]) } : null;
}
