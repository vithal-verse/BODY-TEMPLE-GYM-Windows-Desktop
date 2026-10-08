"use client";

import { Banknote, Smartphone, CreditCard, MoreHorizontal } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { PaymentMethod } from "@/types/database";

const METHOD_META: Record<PaymentMethod, { label: string; icon: typeof Banknote }> = {
  cash: { label: "Cash", icon: Banknote },
  upi: { label: "UPI", icon: Smartphone },
  card: { label: "Card", icon: CreditCard },
  other: { label: "Other", icon: MoreHorizontal },
};

export default function RevenueMethodBreakdown({
  byMethod,
}: {
  /** Revenue per payment method for the selected date range (computed by the database). */
  byMethod: Record<PaymentMethod, number>;
}) {
  const totals = byMethod;
  const grandTotal = (Object.values(byMethod) as number[]).reduce((sum, v) => sum + v, 0);

  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(METHOD_META) as PaymentMethod[]).map((method) => {
        const { label, icon: Icon } = METHOD_META[method];
        const amount = totals[method];
        const pct = grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0;
        return (
          <div key={method} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-body text-sm text-paper">
                <Icon className="h-4 w-4 text-mango" />
                {label}
              </span>
              <span className="font-body text-sm text-paper/70">
                {formatCurrency(amount)}{" "}
                <span className="text-paper/40">({pct}%)</span>
              </span>
            </div>
            <div className="h-1.5 w-full bg-ink">
              <div className="h-full bg-mango" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
