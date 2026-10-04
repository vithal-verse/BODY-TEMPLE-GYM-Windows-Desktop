import { google } from "googleapis";

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

/**
 * Lazily creates an authenticated Google Sheets client using a service
 * account. Returns null (rather than throwing) when credentials aren't
 * configured yet, so the app runs fine before Sheets sync is set up.
 */
export function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY;

  if (!email || !key) return null;

  const auth = new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

export function isSheetsSyncConfigured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
      process.env.GOOGLE_SHEETS_PRIVATE_KEY &&
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  );
}
