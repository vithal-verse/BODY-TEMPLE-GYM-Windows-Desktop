import { API_METHODS, type GymApi, type GymBridge } from "@shared/api";
import type { ErrorCode, Result } from "@shared/errors";

declare global {
  interface Window {
    /** Injected by the Electron preload script (see electron/preload/index.ts). */
    gym?: GymBridge;
  }
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

type RawFn = (input?: unknown) => Promise<Result<unknown>>;

function bridge(): Record<string, Record<string, RawFn>> {
  if (typeof window === "undefined" || !window.gym) {
    throw new ApiError("UNKNOWN", "This screen only works inside the Body Temple Gym desktop app.");
  }
  return window.gym as unknown as Record<string, Record<string, RawFn>>;
}

function build(): GymApi {
  const out: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
  for (const [ns, methods] of Object.entries(API_METHODS)) {
    out[ns] = {};
    for (const method of methods as readonly string[]) {
      out[ns][method] = async (input?: unknown) => {
        const res = await bridge()[ns][method](input);
        if (!res.ok) throw new ApiError(res.error.code, res.error.message);
        return res.data;
      };
    }
  }
  return out as unknown as GymApi;
}

/** Typed, promise-based access to the main process. Rejects with ApiError carrying a user-friendly message. */
export const api: GymApi = build();

export const errorMessage = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong.");
