"use client";

/**
 * Last-resort boundary for errors that propagate past the root layout (e.g.
 * layout itself throws). Renders its own <html>/<body> per Next.js docs.
 * Styles inline so it still renders if globals.css fails to load.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background:
            "linear-gradient(180deg, #070f1f 0%, #0b1e3d 45%, #0c2748 100%)",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            padding: "2rem",
            borderRadius: 16,
            background: "rgba(6, 13, 26, 0.85)",
            border: "1px solid rgba(255,255,255,0.1)",
            textAlign: "center",
          }}
        >
          <div
            aria-hidden
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              margin: "0 auto",
              display: "grid",
              placeItems: "center",
              background: "rgba(244,63,94,0.1)",
              border: "1px solid rgba(244,63,94,0.3)",
              color: "#fda4af",
              fontSize: 24,
            }}
          >
            !
          </div>
          <h1
            style={{
              marginTop: 16,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "#ffffff",
            }}
          >
            Sentinel hit a critical error
          </h1>
          <p style={{ marginTop: 4, fontSize: 14, color: "#94a3b8" }}>
            The app couldn&rsquo;t recover. Try reloading — your care team&rsquo;s
            alert pipeline continues running in the background.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: 12,
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#64748b",
              }}
            >
              Ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              padding: "0.55rem 1rem",
              borderRadius: 12,
              border: "none",
              background: "rgba(59,130,246,0.9)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              boxShadow: "0 0 24px rgba(96,165,250,0.35)",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
