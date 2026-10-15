"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={["dark", "light"]} disableTransitionOnChange>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!bg-surface-2 !border !border-line !text-fg !rounded-xl !shadow-card",
            description: "!text-muted",
          },
        }}
      />
    </ThemeProvider>
  );
}
