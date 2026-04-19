/** Subtle blue-only atmosphere (no purple / cyan blobs). */
export function Aurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div
        className="absolute -left-[10%] -top-[20%] h-[50vmax] w-[50vmax] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(circle at center, rgba(37,99,235,0.35) 0%, rgba(37,99,235,0) 70%)",
        }}
      />
      <div
        className="absolute -right-[12%] top-[10%] h-[45vmax] w-[45vmax] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(circle at center, rgba(30,64,175,0.28) 0%, rgba(30,64,175,0) 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(15,23,42,0) 0%, rgba(15,23,42,0.45) 100%)",
        }}
      />
    </div>
  );
}
