import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { PatientLiveView } from "@/components/patient/PatientLiveView";

export const revalidate = 0;

async function getSession(): Promise<{ role: string; patient_id?: string } | null> {
  const token = cookies().get("sentinel_session")?.value;
  if (!token) return null;
  const backend = process.env.BACKEND_URL ?? "http://localhost:8000";
  try {
    const r = await fetch(`${backend}/api/auth/me`, {
      headers: { cookie: `sentinel_session=${token}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export default async function PatientHome() {
  const session = await getSession();
  if (!session || session.role !== "patient" || !session.patient_id) {
    redirect("/login");
  }
  const pid = session.patient_id;
  const [patients, calls] = await Promise.all([
    api.patients().catch(() => []),
    api.calls(pid).catch(() => []),
  ]);
  const me = patients.find((p) => p.id === pid);
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

  return (
    <PatientLiveView
      patientId={pid}
      patientName={me?.name ?? "Patient"}
      initialCalls={calls}
      agentId={agentId}
    />
  );
}
