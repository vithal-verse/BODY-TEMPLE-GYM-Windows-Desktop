export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ALREADY_CHECKED_IN"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "DATABASE"
  | "IO"
  | "NETWORK"
  | "UNKNOWN";

export type ApiErrorShape = { code: ErrorCode; message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiErrorShape };

/** Error with a stable code and a message that is safe to show to the user. */
export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}
