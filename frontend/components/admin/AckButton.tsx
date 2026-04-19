"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export function AckButton({
  alertId,
  onDone,
}: {
  alertId: string;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function click(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api.ackAlert(alertId);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      disabled={busy}
      onClick={click}
      className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-white/10 disabled:opacity-50"
    >
      {busy ? "…" : "Ack"}
    </button>
  );
}
