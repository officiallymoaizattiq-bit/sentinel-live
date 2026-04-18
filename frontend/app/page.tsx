import { api } from "@/lib/api";
import { PatientCard } from "@/components/PatientCard";
import { AlertFeed } from "@/components/AlertFeed";

export const revalidate = 0;

export default async function Dashboard() {
  const patients = await api.patients();
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <section className="md:col-span-2">
        <h2 className="mb-2 text-lg font-semibold">Patients</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {patients.map((p) => (
            <PatientCard key={p.id} p={p} />
          ))}
        </div>
      </section>
      <aside>
        <h2 className="mb-2 text-lg font-semibold">Recent alerts</h2>
        <AlertFeed />
      </aside>
    </div>
  );
}
