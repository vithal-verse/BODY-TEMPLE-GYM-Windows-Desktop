/**
 * Domain types shared by the Electron main process, the preload bridge and
 * the Next.js renderer. Shapes intentionally match the original Supabase
 * schema (src/types/database.ts in the web app) so UI code stays unchanged.
 * Money is exposed to the UI in rupees (number); the database stores
 * integer paise internally so sums never drift.
 */

export type MemberStatus = "active" | "expired" | "paused";
export type PaymentMethod = "cash" | "upi" | "card" | "other";
export const PAYMENT_METHOD_VALUES = ["cash", "upi", "card", "other"] as const;
export const MEMBER_STATUS_VALUES = ["active", "expired", "paused"] as const;

export type MembershipPlan = {
  id: number;
  name: string;
  duration_months: number;
  fee_amount: number;
  created_at: string;
};

export type Member = {
  id: string;
  name: string;
  age: number | null;
  email: string | null;
  phone: string | null;
  plan_id: number | null;
  plan_name: string | null;
  start_date: string;
  end_date: string | null;
  fees_paid: number; // running total actually paid toward the current term
  amount_due: number; // what's owed for the current term
  status: MemberStatus;
  paused_at: string | null; // set while status is 'paused'; null otherwise
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Renewal = {
  id: string;
  member_id: string;
  plan_id: number | null;
  plan_name: string | null;
  amount: number; // running total actually paid toward this term
  amount_due: number; // what's owed for this term
  start_date: string;
  end_date: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  member_id: string;
  renewal_id: string;
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  notes: string | null;
};

export type Attendance = {
  id: string;
  member_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  duration_minutes: number | null;
};

export type AdminRole = "admin" | "owner";

export type AdminProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AdminRole;
  created_at: string;
  last_login_at: string | null;
};

export type SessionInfo = {
  adminId: string;
  email: string;
  fullName: string | null;
  displayName: string;
  role: AdminRole;
};

export type AuthStatus = {
  hasAdmin: boolean;
  session: SessionInfo | null;
};

// ---------------------------------------------------------------------------
// Query / input DTOs
// ---------------------------------------------------------------------------

export type SortDir = "asc" | "desc";
export type MemberStatusFilter = "all" | "active" | "expired" | "paused" | "expiring";
export type MemberSortKey = "name" | "start_date" | "end_date" | "fees_paid";

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type MemberListQuery = {
  query?: string;
  status?: MemberStatusFilter;
  sortKey?: MemberSortKey;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
};

export type MemberCreateInput = {
  name: string;
  age?: number | null;
  email?: string | null;
  phone?: string | null;
  plan_id?: number | null;
  start_date: string; // yyyy-MM-dd
  end_date?: string | null;
  amount_due?: number;
  initial_payment?: number;
  payment_method?: PaymentMethod;
  notes?: string | null;
};

export type MemberUpdateInput = {
  name: string;
  age?: number | null;
  email?: string | null;
  phone?: string | null;
  plan_id?: number | null;
  start_date: string;
  end_date?: string | null;
  amount_due?: number;
  notes?: string | null;
};

export type RenewInput = {
  plan_id?: number | null;
  start_date: string;
  end_date?: string | null;
  amount_due?: number;
  paid_now?: number;
  method?: PaymentMethod;
};

export type RecordPaymentInput = {
  amount: number;
  method: PaymentMethod;
  notes?: string | null;
};

export type PlanInput = {
  name: string;
  duration_months: number;
  fee_amount: number;
};

export type DashboardStats = {
  totalMembers: number;
  activeMembers: number;
  expiredMembers: number;
  totalRevenue: number;
  expiringSoon: Member[];
  revenueByMonth: { month: string; revenue: number }[];
  checkedInTodayCount: number;
  checkedInToday: { member: Member; checkedInAt: string }[];
};

export type AttendanceStats = {
  todaysCheckInCount: number;
  currentlyCheckedInCount: number;
  todaysCheckoutCount: number;
  averageDurationMinutesToday: number | null;
};

export type TrendGranularity = "daily" | "weekly" | "monthly";
export type AttendanceTrendGranularity = TrendGranularity;
export type RevenueTrendGranularity = TrendGranularity;
export type AttendanceTrendPoint = { label: string; count: number };
export type RevenueTrendPoint = { label: string; amount: number };

export type AttendanceWithMember = { member: Member; session: Attendance };

export type AttendanceHistoryQuery = {
  query?: string;
  startDate?: string; // yyyy-MM-dd (local)
  endDate?: string; // yyyy-MM-dd (local)
  page?: number;
  pageSize?: number;
};

export type PaymentWithMember = { payment: Payment; member: Member };

export type RevenueQuery = {
  startIso: string; // inclusive
  endIso: string; // exclusive
  method?: PaymentMethod | "all";
  query?: string;
  sortKey?: "paid_at" | "amount";
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
};

export type RevenueReport = {
  summary: {
    totalAmount: number;
    paymentCount: number;
    averagePayment: number;
    byMethod: Record<PaymentMethod, number>;
  };
  table: Page<PaymentWithMember> & { filteredTotal: number };
  pendingDues: number;
};

// ---------------------------------------------------------------------------
// Data safety
// ---------------------------------------------------------------------------

export type BackupKind =
  | "manual"
  | "auto"
  | "pre-restore"
  | "pre-migration"
  | "pre-import"
  | "exported";

export type BackupEntry = {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  kind: BackupKind;
};

export type BackupVerification = {
  ok: boolean;
  schemaVersion: number | null;
  memberCount: number | null;
  message: string;
};

export type BackupSettings = {
  autoEnabled: boolean;
  intervalHours: number;
  keepAuto: number;
  secondaryDir: string | null;
};

export type ActionResult = { done: boolean; path?: string; message?: string };

export type AppInfo = {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  logDir: string;
  schemaVersion: number;
  dbSizeBytes: number;
  lastIntegrityCheck: { at: string; ok: boolean; message: string } | null;
};

// ---------------------------------------------------------------------------
// Google Sheets (optional)
// ---------------------------------------------------------------------------

export type SheetsConfigView = {
  spreadsheetId: string;
  clientEmail: string;
  hasPrivateKey: boolean;
  autoSync: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
};

export type SheetsConfigInput = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey?: string; // omit to keep the stored key
  autoSync: boolean;
};

export type SheetsPushResult = { synced: number };
export type SheetsPullResult = { updatedMembers: number; fieldsChanged: number; conflictsSkipped: number };

// ---------------------------------------------------------------------------
// Import from Supabase
// ---------------------------------------------------------------------------

export type ImportMode = "merge" | "replace";

export type ImportSummary = {
  plans: number;
  members: number;
  renewals: number;
  payments: number;
  attendance: number;
  skipped: { table: string; count: number; reason: string }[];
  warnings: string[];
  backupFile: string | null;
};

export type SupabaseImportInput = {
  url: string;
  serviceKey: string;
  mode: ImportMode;
};
