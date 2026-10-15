"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** One-off toasts driven by query flags set after redirects, then cleaned from the URL. */
export function DashboardNotices() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let shown = false;
    if (params.get("welcome")) {
      toast.success("Your workspace is ready. Add your first school to get started.");
      shown = true;
    }
    if (params.get("demo")) {
      toast("Welcome to the demo", { description: "Northbridge Academy is fictional. Look around — nothing you see is real customer data." });
      shown = true;
    }
    if (params.get("joined")) {
      toast.success("You've joined the workspace. Welcome aboard.");
      shown = true;
    }
    if (params.get("passwordReset")) {
      toast.success("Password updated. You're signed in.");
      shown = true;
    }
    if (params.get("denied")) {
      toast.error("Your role doesn't have access to that page.");
      shown = true;
    }
    if (shown) router.replace(pathname, { scroll: false });
  }, [params, router, pathname]);

  return null;
}
