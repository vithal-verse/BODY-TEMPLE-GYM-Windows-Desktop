"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-provider";
import { PageState } from "@/components/page-state";

export default function Home() {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.loading) return;
    router.replace(!state.hasAdmin ? "/setup/" : state.session ? "/dashboard/" : "/login/");
  }, [state, router]);
  return <PageState label="Opening Body Temple Gym…" />;
}
