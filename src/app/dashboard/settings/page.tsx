"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Database, FileSpreadsheet, Tag, Upload, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageState } from "@/components/page-state";
import PlansPanel from "@/components/settings/plans-panel";
import DataPanel from "@/components/settings/data-panel";
import SheetsPanel from "@/components/settings/sheets-panel";
import ImportPanel from "@/components/settings/import-panel";
import AccountPanel from "@/components/settings/account-panel";

const TABS = [
  { key: "data", label: "Data safety", icon: Database },
  { key: "plans", label: "Plans", icon: Tag },
  { key: "sheets", label: "Google Sheets", icon: FileSpreadsheet },
  { key: "import", label: "Import", icon: Upload },
  { key: "account", label: "Account", icon: UserCog },
] as const;
type Tab = (typeof TABS)[number]["key"];

function SettingsTabs() {
  const raw = useSearchParams().get("tab");
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "data";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 border-b-2 border-ink-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/settings/?tab=${t.key}`}
            replace
            className={cn(
              "-mb-0.5 flex items-center gap-2 border-b-2 px-4 py-3 font-body text-sm font-medium transition-colors",
              tab === t.key ? "border-mango text-mango" : "border-transparent text-paper/50 hover:text-paper"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "data" && <DataPanel />}
      {tab === "plans" && <PlansPanel />}
      {tab === "sheets" && <SheetsPanel />}
      {tab === "import" && <ImportPanel />}
      {tab === "account" && <AccountPanel />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Settings</h2>
        <p className="font-body text-sm text-paper/40">Backups, plans, optional Google Sheets sync, importing old data, and accounts.</p>
      </div>
      <Suspense fallback={<PageState />}>
        <SettingsTabs />
      </Suspense>
    </div>
  );
}
