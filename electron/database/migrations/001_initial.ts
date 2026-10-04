/**
 * Initial schema — the SQLite equivalent of the Supabase schema.sql plus its
 * dated migration snippets (attendance, check-out, pause, renewals,
 * payments). Money columns are integer paise; timestamps are ISO-8601 UTC
 * strings; dates are local yyyy-MM-dd strings (same as Postgres `date`).
 */
export const SQL_001_INITIAL = `
CREATE TABLE membership_plans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  duration_months INTEGER NOT NULL CHECK (duration_months > 0),
  fee_paise       INTEGER NOT NULL DEFAULT 0 CHECK (fee_paise >= 0),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE members (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
  age              INTEGER CHECK (age IS NULL OR (age >= 1 AND age <= 120)),
  email            TEXT,
  phone            TEXT,
  plan_id          INTEGER REFERENCES membership_plans(id) ON DELETE SET NULL,
  plan_name        TEXT,  -- denormalised snapshot so history survives plan edits/removal
  start_date       TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date         TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  fees_paid_paise  INTEGER NOT NULL DEFAULT 0 CHECK (fees_paid_paise >= 0),
  amount_due_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_due_paise >= 0),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'paused')),
  paused_at        TEXT CHECK (paused_at IS NULL OR paused_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_members_status     ON members(status);
CREATE INDEX idx_members_end_date   ON members(end_date);
CREATE INDEX idx_members_name       ON members(name COLLATE NOCASE);
CREATE INDEX idx_members_created_at ON members(created_at DESC);

-- Safety net: keep updated_at current even for edits made outside the app.
CREATE TRIGGER trg_members_updated_at
AFTER UPDATE ON members
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE members SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- One row per visit. checked_out_at is NULL while the member is on the floor.
CREATE TABLE attendance (
  id               TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  checked_in_at    TEXT NOT NULL,
  checked_out_at   TEXT,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0)
);
CREATE INDEX idx_attendance_member_id      ON attendance(member_id, checked_in_at DESC);
CREATE INDEX idx_attendance_checked_in_at  ON attendance(checked_in_at);
CREATE INDEX idx_attendance_checked_out_at ON attendance(checked_out_at);
-- "No duplicate active check-ins" enforced by the database, not just the UI.
CREATE UNIQUE INDEX idx_attendance_one_active_per_member
  ON attendance(member_id) WHERE checked_out_at IS NULL;

-- Append-only history of each membership term (including the initial signup).
CREATE TABLE renewals (
  id               TEXT PRIMARY KEY,
  member_id        TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id          INTEGER REFERENCES membership_plans(id) ON DELETE SET NULL,
  plan_name        TEXT,
  amount_paise     INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  amount_due_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_due_paise >= 0),
  start_date       TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date         TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_renewals_member_id ON renewals(member_id, created_at DESC);

-- Individual payment transactions against a term (a renewals row).
CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
  renewal_id   TEXT NOT NULL REFERENCES renewals(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'other')),
  paid_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  notes        TEXT
);
CREATE INDEX idx_payments_member_id  ON payments(member_id, paid_at DESC);
CREATE INDEX idx_payments_renewal_id ON payments(renewal_id);
CREATE INDEX idx_payments_paid_at    ON payments(paid_at);

-- Local administrator accounts (replaces Supabase Auth + admin_profiles).
CREATE TABLE admin_profiles (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(email)) > 3),
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'owner')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Credentials live apart from the profile, mirroring auth.users vs admin_profiles.
-- Passwords and recovery codes are stored only as salted scrypt hashes.
CREATE TABLE admin_credentials (
  admin_id            TEXT PRIMARY KEY REFERENCES admin_profiles(id) ON DELETE CASCADE,
  password_hash       TEXT NOT NULL,
  recovery_hash       TEXT,
  password_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT
);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Starter plans (same as the web app's seed data).
INSERT INTO membership_plans (name, duration_months, fee_paise) VALUES
  ('1 Month', 1, 150000),
  ('2 Months', 2, 200000),
  ('3 Months', 3, 250000),
  ('4 Months', 4, 320000);
`;
