"use client";

import { useState } from "react";

/** Copies a link. The only client JS the "continue on your phone" panel needs. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (e.g. http on a LAN IP): the link is shown above.
        }
      }}
      className="min-h-11 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
