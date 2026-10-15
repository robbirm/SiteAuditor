"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Download, FileUp, Upload } from "lucide-react";
import { importAssetsAction, type ImportResult } from "@/actions/asset-import";
import { Button } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-classes";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/utils";

async function runImport(csv: string, commit: boolean): Promise<ImportResult> {
  try {
    return await importAssetsAction({ csv, commit });
  } catch {
    return { created: 0, updated: 0, failed: 0, rows: [], error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export function ImportAssetsButton({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFileName(null);
    setCsv(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setResult({ created: 0, updated: 0, failed: 0, rows: [], error: "That file is over 2 MB. Split it into smaller files." });
      return;
    }
    setFileName(file.name);
    setBusy(true);
    const text = await file.text();
    setCsv(text);
    setResult(await runImport(text, false));
    setBusy(false);
  }

  async function commit() {
    if (!csv) return;
    setBusy(true);
    const res = await runImport(csv, true);
    setBusy(false);
    setResult(res);
    if (res.committed) {
      toast.success(`Imported: ${res.created} added, ${res.updated} updated${res.failed ? `, ${res.failed} skipped` : ""}.`);
      router.refresh();
    }
  }

  const problems = result?.rows.filter((r) => r.action === "error") ?? [];
  const importable = (result?.created ?? 0) + (result?.updated ?? 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Import equipment from CSV"
        description="Rows with an asset tag that already exists update that device. Everything else is added as new."
        className="sm:max-w-2xl"
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg/50 p-4">
            <div className="text-sm">
              <p className="font-medium">Start from the template</p>
              <p className="text-muted">It has every column, with example rows using your own school and rooms.</p>
            </div>
            <a href="/api/assets/template" className={buttonClasses("secondary", "sm")} download>
              <Download className="h-3.5 w-3.5" />
              Download template
            </a>
          </div>

          {!result?.committed ? (
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-7 text-center transition-colors hover:border-accent/60",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <FileUp className="h-6 w-6 text-accent" />
              <span className="text-sm font-medium">{fileName ?? "Choose a CSV file"}</span>
              <span className="text-xs text-muted">Up to 2,000 rows. Saved from Excel or Google Sheets as CSV.</span>
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          ) : null}

          {busy ? <p className="text-sm text-muted">Checking the file…</p> : null}
          <FormError message={result?.error} />

          {result && !result.error ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line text-center">
                {[
                  ["To add", result.created, "text-success"],
                  ["To update", result.updated, "text-info"],
                  ["Can't import", result.failed, result.failed ? "text-danger" : "text-muted"],
                ].map(([label, value, tone]) => (
                  <div key={label as string} className="bg-surface px-3 py-3">
                    <p className={cn("font-display text-2xl font-semibold tabular-nums", tone as string)}>{value as number}</p>
                    <p className="text-xs text-muted">{result.committed ? String(label).replace("To add", "Added").replace("To update", "Updated").replace("Can't import", "Skipped") : (label as string)}</p>
                  </div>
                ))}
              </div>

              {problems.length > 0 ? (
                <div className="rounded-xl border border-danger/30 bg-danger/5">
                  <p className="flex items-center gap-2 border-b border-danger/20 px-4 py-2.5 text-sm font-medium text-danger">
                    <AlertCircle className="h-4 w-4" />
                    {problems.length} {problems.length === 1 ? "row needs" : "rows need"} fixing{result.committed ? " (skipped)" : ""}
                  </p>
                  <ul className="max-h-56 divide-y divide-line/50 overflow-y-auto text-sm">
                    {problems.slice(0, 100).map((r) => (
                      <li key={r.line} className="px-4 py-2">
                        <span className="font-medium">Line {r.line}</span>
                        <span className="text-muted">, {r.name}</span>
                        <ul className="mt-0.5 list-disc pl-5 text-xs text-muted">
                          {r.messages.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.committed ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Import complete.
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="ghost" onClick={reset}>
                    Choose another file
                  </Button>
                  <Button onClick={commit} loading={busy} disabled={importable === 0}>
                    {problems.length ? `Import ${importable} valid ${importable === 1 ? "row" : "rows"}` : `Import ${importable} ${importable === 1 ? "row" : "rows"}`}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
