// The domain types now live in shared/types.ts so the Electron main process and the UI agree on one
// definition. This file re-exports them so existing imports keep working.
export * from "@shared/types";
