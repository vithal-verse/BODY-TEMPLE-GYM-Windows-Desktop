"use client";

import AuthShell from "@/components/auth-shell";
import { PageState } from "@/components/page-state";
import { useRedirectIfSignedIn } from "@/components/session-provider";
import SetupForm from "./setup-form";

export default function SetupPage() {
  const state = useRedirectIfSignedIn("setup");
  if (state.loading || state.session || state.hasAdmin) return <PageState label="Opening Body Temple Gym…" />;
  return (
    <AuthShell
      blurb="Welcome! Create the owner account to get started. Everything you enter stays on this computer and works without internet."
      formTitle="Create the owner account"
      formBlurb="You'll use this to sign in each time the app opens."
      footer="First-time setup. This screen only appears once."
    >
      <SetupForm />
    </AuthShell>
  );
}
