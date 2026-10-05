import Link from "next/link";

export function PageState({ error, label = "Loading…" }: { error?: string; label?: string }) {
  if (error) {
    return (
      <div role="alert" className="max-w-xl border-2 border-alert bg-ink-raised p-6">
        <p className="font-display text-lg text-alert">Couldn&apos;t load this page</p>
        <p className="mt-1 font-body text-sm text-paper/60">{error}</p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 py-10 text-paper/50" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-mango border-t-transparent" />
      <span className="font-body text-sm">{label}</span>
    </div>
  );
}

export function NotFoundState({ what, backHref = "/dashboard/members/" }: { what: string; backHref?: string }) {
  return (
    <div className="flex flex-col gap-3 py-6">
      <h2 className="font-display text-2xl text-paper">That {what} wasn&apos;t found</h2>
      <p className="font-body text-sm text-paper/40">It may have been removed. Head back and pick another.</p>
      <Link href={backHref} className="w-fit bg-mango px-5 py-2.5 font-display text-base text-ink">
        Back to all members
      </Link>
    </div>
  );
}
