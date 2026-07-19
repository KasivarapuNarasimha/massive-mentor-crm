"use client";

import { useState } from "react";

/** Hidden by default — only for Super Admin developer inspection. */
export function DeveloperRaw({ data, label = "View Raw Response" }: { data: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border border-dashed border-zinc-800 rounded-xl p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] uppercase tracking-wider text-zinc-600 hover:text-zinc-400"
      >
        Developer Mode · {open ? "Hide" : label}
      </button>
      {open ? (
        <pre className="mt-2 text-[10px] text-zinc-600 overflow-auto max-h-48 bg-zinc-950/80 p-2 rounded-lg">
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
