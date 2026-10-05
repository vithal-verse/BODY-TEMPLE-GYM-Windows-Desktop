"use client";

import AuthShell from "@/components/auth-shell";
import { PageState } from "@/components/page-state";
import { useRedirectIfSignedIn } from "@/components/session-provider";
import LoginForm from "./login-form";

export default function LoginPage() {
  const state = useRedirectIfSignedIn("login");
  if (state.loading || state.session || !state.hasAdmin) return <PageState label="Opening Body Temple Gym…" />;
  return (
    <AuthShell
      blurb="Sign in to manage members, track dues, and keep the gym running — from the front desk or the office."
      formTitle="Admin login"
      formBlurb="Enter your credentials to open the dashboard."
      footer="Admin access only. Contact the gym owner if you need an account."
    >
      <LoginForm />
    </AuthShell>
  );
}
