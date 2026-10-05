export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
  "iloveyou", "admin123", "letmein123", "bodytemple", "bodytemplegym", "welcome123",
]);

/** Returns a human-readable problem with the password, or null when acceptable. */
export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 128) return "Use 128 characters or fewer.";
  if (/^(.)\1+$/.test(pw)) return "Choose something other than one repeated character.";
  if (COMMON.has(pw.toLowerCase())) return "That password is too common — choose something harder to guess.";
  if (email && pw.toLowerCase() === email.trim().toLowerCase()) return "Your password can't be your email address.";
  return null;
}
