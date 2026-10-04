import { NextRequest, NextResponse } from "next/server";
import { getSheetsClient, isSheetsSyncConfigured } from "@/lib/google-sheets";
import { createClient } from "@supabase/supabase-js";
import type { Database, Member } from "@/types/database";

const SHEET_RANGE = "Members!A2:K";
const SHEET_HEADER_RANGE = "Members!A1:K1";
const HEADER = [
  "id",
  "name",
  "age",
  "email",
  "phone",
  "plan_name",
  "start_date",
  "end_date",
  "fees_paid",
  "status",
  "updated_at",
];

/**
 * Called by a Supabase Database Webhook whenever a row in `members`
 * changes (insert/update/delete). Configure this at:
 * Supabase → Database → Webhooks → New webhook → members table →
 * POST https://<your-app>.vercel.app/api/sheet-sync/push
 *
 * This route re-reads the full members table and rewrites the sheet body,
 * which keeps the implementation simple and avoids row-matching bugs —
 * fine at gym-membership scale (hundreds to low thousands of rows).
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  if (secret !== process.env.SHEET_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSheetsSyncConfigured()) {
    return NextResponse.json(
      { skipped: true, reason: "Google Sheets sync not configured" },
      { status: 200 }
    );
  }

  const sheets = getSheetsClient();
  if (!sheets) {
    return NextResponse.json(
      { error: "Sheets client unavailable" },
      { status: 500 }
    );
  }

  const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabaseAdmin
    .from("members")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Give the empty-array fallback an explicit type — `data ?? []` alone lets
  // TypeScript infer `[]` as `never[]`, which then poisons the `.map()`
  // callback's parameter type to `never` once unioned with `Member[]`.
  const members: Member[] = data ?? [];

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: SHEET_HEADER_RANGE,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [HEADER] },
    });

    const rows = members.map((m) => [
      m.id,
      m.name,
      m.age ?? "",
      m.email ?? "",
      m.phone ?? "",
      m.plan_name ?? "",
      m.start_date ?? "",
      m.end_date ?? "",
      m.fees_paid ?? 0,
      m.status,
      m.updated_at,
    ]);

    // Clear old body rows first so deletions are reflected, then write fresh.
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: SHEET_RANGE,
    });

    if (rows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: SHEET_RANGE,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });
    }

    return NextResponse.json({ synced: rows.length });
  } catch (err) {
    console.error("Sheets push error:", err);
    return NextResponse.json(
      { error: "Failed to write to Google Sheets" },
      { status: 502 }
    );
  }
}
