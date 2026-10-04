export type MemberStatus = "active" | "expired" | "paused";
export type PaymentMethod = "cash" | "upi" | "card" | "other";

// NOTE: every shape below uses `type`, never `interface`. This isn't a
// style choice — @supabase/postgrest-js's conditional types (used by
// .eq(), .update(), etc.) fail to resolve against `interface`-declared
// Row/Insert/Update shapes and silently collapse to `never`. Plain `type`
// aliases resolve correctly, which is also what `supabase gen types
// typescript` itself emits. If you regenerate this file from the CLI,
// keep it that way.

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

export type RenewalInsert = Omit<Renewal, "id" | "created_at">;

export type Payment = {
  id: string;
  member_id: string;
  renewal_id: string;
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  notes: string | null;
};

export type PaymentInsert = Omit<Payment, "id" | "paid_at" | "notes"> & {
  paid_at?: string;
  notes?: string | null;
};

export type Attendance = {
  id: string;
  member_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  duration_minutes: number | null;
};

export type AttendanceInsert = Omit<
  Attendance,
  "id" | "checked_in_at" | "checked_out_at" | "duration_minutes"
> & {
  checked_in_at?: string;
  checked_out_at?: string | null;
  duration_minutes?: number | null;
};

export type AttendanceUpdate = Partial<AttendanceInsert>;

export type AdminProfile = {
  id: string;
  full_name: string | null;
  role: "admin" | "owner";
  created_at: string;
};

export type MemberInsert = Omit<
  Member,
  "id" | "created_at" | "updated_at" | "status" | "paused_at"
> & {
  status?: MemberStatus;
  paused_at?: string | null;
};

export type MemberUpdate = Partial<MemberInsert>;

// Minimal Supabase generated-types shape, hand-written to match schema.sql.
// Each table needs Row/Insert/Update/Relationships, and the schema needs
// Tables/Views/Functions, to satisfy @supabase/postgrest-js's GenericSchema
// constraint. If you later run `supabase gen types typescript`, this file
// can be replaced with the generated output.
export type Database = {
  public: {
    Tables: {
      members: {
        Row: Member;
        Insert: MemberInsert;
        Update: MemberUpdate;
        Relationships: [
          {
            foreignKeyName: "members_plan_id_fkey";
            columns: ["plan_id"];
            referencedRelation: "membership_plans";
            referencedColumns: ["id"];
          }
        ];
      };
      membership_plans: {
        Row: MembershipPlan;
        Insert: Omit<MembershipPlan, "id" | "created_at">;
        Update: Partial<Omit<MembershipPlan, "id" | "created_at">>;
        Relationships: [];
      };
      admin_profiles: {
        Row: AdminProfile;
        Insert: Partial<AdminProfile> & { id: string };
        Update: Partial<AdminProfile>;
        Relationships: [];
      };
      renewals: {
        Row: Renewal;
        Insert: RenewalInsert;
        Update: Partial<RenewalInsert>;
        Relationships: [
          {
            foreignKeyName: "renewals_member_id_fkey";
            columns: ["member_id"];
            referencedRelation: "members";
            referencedColumns: ["id"];
          }
        ];
      };
      attendance: {
        Row: Attendance;
        Insert: AttendanceInsert;
        Update: Partial<AttendanceInsert>;
        Relationships: [
          {
            foreignKeyName: "attendance_member_id_fkey";
            columns: ["member_id"];
            referencedRelation: "members";
            referencedColumns: ["id"];
          }
        ];
      };
      payments: {
        Row: Payment;
        Insert: PaymentInsert;
        Update: Partial<PaymentInsert>;
        Relationships: [
          {
            foreignKeyName: "payments_member_id_fkey";
            columns: ["member_id"];
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_renewal_id_fkey";
            columns: ["renewal_id"];
            referencedRelation: "renewals";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
