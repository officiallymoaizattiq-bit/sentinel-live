"use client";

import { useEffect, useRef, useState } from "react";

export default function Diag() {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState("init");
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const add = (s: string) =>
      setLines((prev) => [...prev, `${new Date().toISOString().slice(11, 19)} ${s}`]);
    const url = `/api/stream?t=${Date.now()}`;
    add(`opening ${url}`);
    const es = new EventSource(url);
    es.onopen = () => { setStatus("open"); add("onopen"); };
    es.onmessage = (e) => add(`msg: ${e.data.slice(0, 120)}`);
    es.onerror = () => { setStatus("error"); add("onerror"); };
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "monospace", fontSize: 14, color: "#ddd", background: "#111", minHeight: "100vh" }}>
      <h1>SSE diag</h1>
      <p>status: {status}</p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{lines.join("\n")}</pre>
    </div>
  );
}
