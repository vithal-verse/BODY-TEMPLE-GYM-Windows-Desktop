import type { Result } from "./errors";
import type {
  ActionResult,
  AdminProfile,
  AdminRole,
  AppInfo,
  AttendanceHistoryQuery,
  Attendance,
  AttendanceStats,
  AttendanceTrendGranularity,
  AttendanceTrendPoint,
  AttendanceWithMember,
  AuthStatus,
  BackupEntry,
  BackupSettings,
  BackupVerification,
  DashboardStats,
  ImportSummary,
  Member,
  MemberCreateInput,
  MemberListQuery,
  MemberUpdateInput,
  MembershipPlan,
  Page,
  Payment,
  PlanInput,
  RecordPaymentInput,
  Renewal,
  RenewInput,
  RevenueQuery,
  RevenueReport,
  RevenueTrendGranularity,
  RevenueTrendPoint,
  SessionInfo,
  SheetsConfigInput,
  SheetsConfigView,
  SheetsPullResult,
  SheetsPushResult,
  SupabaseImportInput,
  ImportMode,
} from "./types";

/**
 * The complete surface exposed to the renderer through the preload bridge.
 * Nothing outside this interface is reachable from the UI: the preload
 * script builds `window.gym` from API_METHODS below, and the main process
 * registers exactly one validated handler per entry.
 */
export interface GymApi {
  auth: {
    status(): Promise<AuthStatus>;
    setup(input: { full_name: string; email: string; password: string }): Promise<{
      session: SessionInfo;
      recoveryCode: string;
    }>;
    login(input: { email: string; password: string }): Promise<SessionInfo>;
    logout(): Promise<void>;
    changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
    resetPassword(input: {
      email: string;
      recoveryCode: string;
      newPassword: string;
    }): Promise<{ recoveryCode: string }>;
    listAdmins(): Promise<AdminProfile[]>;
    createAdmin(input: {
      full_name: string;
      email: string;
      password: string;
      role: AdminRole;
    }): Promise<{ admin: AdminProfile; recoveryCode: string }>;
    removeAdmin(input: { id: string }): Promise<void>;
  };
  plans: {
    list(): Promise<MembershipPlan[]>;
    create(input: PlanInput): Promise<MembershipPlan>;
    update(input: { id: number; patch: PlanInput }): Promise<MembershipPlan>;
    remove(input: { id: number }): Promise<void>;
  };
  members: {
    list(input: MemberListQuery): Promise<Page<Member>>;
    get(input: { id: string }): Promise<Member | null>;
    search(input: { query: string; limit?: number }): Promise<Member[]>;
    create(input: MemberCreateInput): Promise<Member>;
    update(input: { id: string; patch: MemberUpdateInput }): Promise<Member>;
    remove(input: { id: string }): Promise<void>;
    pause(input: { id: string }): Promise<Member>;
    resume(input: { id: string }): Promise<Member>;
    renew(input: { id: string; input: RenewInput }): Promise<Member>;
    recordPayment(input: { id: string; input: RecordPaymentInput }): Promise<Member>;
    renewals(input: { memberId: string }): Promise<Renewal[]>;
    currentRenewal(input: { memberId: string }): Promise<Renewal | null>;
    payments(input: { memberId: string }): Promise<Payment[]>;
  };
  attendance: {
    checkIn(input: { memberId: string }): Promise<Attendance>;
    checkOut(input: { sessionId: string }): Promise<Attendance>;
    active(): Promise<AttendanceWithMember[]>;
    stats(): Promise<AttendanceStats>;
    trend(): Promise<Record<AttendanceTrendGranularity, AttendanceTrendPoint[]>>;
    history(input: AttendanceHistoryQuery): Promise<Page<AttendanceWithMember>>;
    memberHistory(input: { memberId: string; limit?: number }): Promise<Attendance[]>;
  };
  dashboard: {
    stats(): Promise<DashboardStats>;
  };
  revenue: {
    report(input: RevenueQuery): Promise<RevenueReport>;
    trend(): Promise<Record<RevenueTrendGranularity, RevenueTrendPoint[]>>;
  };
  exports: {
    members(): Promise<ActionResult>;
    revenue(input: RevenueQuery): Promise<ActionResult>;
  };
  backup: {
    list(): Promise<BackupEntry[]>;
    create(): Promise<BackupEntry>;
    exportTo(): Promise<ActionResult>;
    restoreFromList(input: { fileName: string }): Promise<ActionResult>;
    restoreFromFile(): Promise<ActionResult>;
    verify(input: { fileName: string }): Promise<BackupVerification>;
    remove(input: { fileName: string }): Promise<void>;
    getSettings(): Promise<BackupSettings>;
    saveSettings(input: BackupSettings): Promise<BackupSettings>;
    chooseSecondaryDir(): Promise<string | null>;
    checkIntegrity(): Promise<{ ok: boolean; message: string }>;
  };
  sheets: {
    getConfig(): Promise<SheetsConfigView>;
    saveConfig(input: SheetsConfigInput): Promise<SheetsConfigView>;
    test(): Promise<{ title: string }>;
    push(): Promise<SheetsPushResult>;
    pull(): Promise<SheetsPullResult>;
  };
  importer: {
    fromFolder(input: { mode: ImportMode }): Promise<ImportSummary | null>;
    fromSupabase(input: SupabaseImportInput): Promise<ImportSummary>;
  };
  system: {
    info(): Promise<AppInfo>;
    openLogs(): Promise<void>;
    openDataFolder(): Promise<void>;
  };
}

type MethodNames<T> = readonly (keyof T & string)[];

/** Static allow-list of IPC methods. The preload script uses this to build `window.gym`. */
export const API_METHODS = {
  auth: ["status", "setup", "login", "logout", "changePassword", "resetPassword", "listAdmins", "createAdmin", "removeAdmin"],
  plans: ["list", "create", "update", "remove"],
  members: [
    "list", "get", "search", "create", "update", "remove", "pause", "resume",
    "renew", "recordPayment", "renewals", "currentRenewal", "payments",
  ],
  attendance: ["checkIn", "checkOut", "active", "stats", "trend", "history", "memberHistory"],
  dashboard: ["stats"],
  revenue: ["report", "trend"],
  exports: ["members", "revenue"],
  backup: [
    "list", "create", "exportTo", "restoreFromList", "restoreFromFile", "verify", "remove",
    "getSettings", "saveSettings", "chooseSecondaryDir", "checkIntegrity",
  ],
  sheets: ["getConfig", "saveConfig", "test", "push", "pull"],
  importer: ["fromFolder", "fromSupabase"],
  system: ["info", "openLogs", "openDataFolder"],
} as const satisfies { [K in keyof GymApi]: MethodNames<GymApi[K]> };

export type ApiNamespace = keyof typeof API_METHODS;

// Compile-time guarantee that the allow-list above is exhaustive: adding a
// method to GymApi without listing it in API_METHODS is a type error, so it
// can never be silently unreachable (or silently missing from validation).
type MissingFromAllowList = {
  [K in keyof GymApi]: Exclude<keyof GymApi[K], (typeof API_METHODS)[K][number]>;
}[keyof GymApi];
export const _allowListIsExhaustive: [MissingFromAllowList] extends [never] ? true : never = true;

/** Channel naming convention shared by preload and main. */
export const channelFor = (ns: string, method: string) => `gym:${ns}:${method}`;

/** Events pushed from main to the renderer (subscribe-only, allow-listed). */
export const EVENT_NAVIGATE = "gym:event:navigate";
export const EVENT_SESSION_ENDED = "gym:event:session-ended";

export interface GymBridge extends WrappedApi {
  events: {
    onNavigate(cb: (path: string) => void): () => void;
    onSessionEnded(cb: (reason: string) => void): () => void;
  };
  platform: string;
}

type Wrapped<T> = {
  [NS in keyof T]: {
    [M in keyof T[NS]]: T[NS][M] extends (...args: infer A) => Promise<infer R>
      ? (...args: A) => Promise<Result<R>>
      : never;
  };
};
export type WrappedApi = Wrapped<GymApi>;
