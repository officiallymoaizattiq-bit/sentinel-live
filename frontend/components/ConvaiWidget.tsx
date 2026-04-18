"use client";

import { useEffect, useState } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "elevenlabs-convai": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { "agent-id": string },
        HTMLElement
      >;
    }
  }
}

const WIDGET_SRC = "https://elevenlabs.io/convai-widget/index.js";

export function ConvaiWidget({ agentId }: { agentId: string }) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (document.querySelector(`script[src="${WIDGET_SRC}"]`)) {
      setLoaded(true);
      return;
    }
    const s = document.createElement("script");
    s.src = WIDGET_SRC;
    s.async = true;
    s.type = "text/javascript";
    s.onload = () => setLoaded(true);
    document.body.appendChild(s);
  }, []);

  if (!agentId) {
    return (
      <div className="rounded border border-slate-800 p-4 text-sm text-slate-400">
        Convai widget disabled — set{" "}
        <code className="font-mono">NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code>.
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Talk to Sentinel now</h3>
        <span className="text-xs text-slate-500">ElevenLabs Conversational AI</span>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Click the mic to start a live check-in conversation. Transcript streams
        to the scoring pipeline after the call ends.
      </p>
      <elevenlabs-convai agent-id={agentId}></elevenlabs-convai>
      {!loaded && (
        <div className="mt-2 text-xs text-slate-500">Loading widget…</div>
      )}
    </div>
  );
}
