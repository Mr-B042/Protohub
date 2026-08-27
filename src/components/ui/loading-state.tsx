import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type LoadingStateProps = { label?: string; className?: string; compact?: boolean };

/** Consistent, accessible loading feedback for async dashboard surfaces. */
export function LoadingState({ label = "Loading", className, compact = false }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center justify-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400", compact ? "py-3" : "min-h-32 py-8", className)}>
      <LoaderCircle className="h-4 w-4 animate-spin text-[#1F8FE0]" aria-hidden="true" />
      <span>{label}<span aria-hidden="true">…</span></span>
    </div>
  );
}
