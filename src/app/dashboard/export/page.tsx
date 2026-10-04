import { getMembers } from "@/lib/members";
import ExportPanel from "@/components/export-panel";

export default async function ExportPage() {
  const members = await getMembers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Export data</h2>
        <p className="font-body text-sm text-paper/40">
          Download your full member list as a CSV file — for backups,
          reporting, or your own spreadsheet.
        </p>
      </div>

      <ExportPanel members={members} />
    </div>
  );
}
