import { Suspense, lazy, type ComponentProps, type ComponentType } from "react";

/**
 * A page or big panel whose code is downloaded only when it is first shown
 * (Bright, 30 Oct 2026: "the web app is slow and hangs on low-end phones and
 * laptops"). Everything used to ship in one 7.7 MB file that every device had
 * to download and prepare before the app could start.
 *
 * Each one carries its own Suspense, so while its code arrives only that spot
 * shows "Loading…". Without it the app-level fallback in main.tsx would take
 * over the whole screen (and reload after 12 s on a slow device).
 */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const Lazy = lazy(load);
  function LazyPage(props: ComponentProps<T>) {
    return (
      <Suspense fallback={<PageLoading />}>
        <Lazy {...(props as any)} />
      </Suspense>
    );
  }
  return LazyPage;
}

function PageLoading() {
  return (
    <div role="status" className="flex min-h-[160px] items-center justify-center gap-2 text-[13px] font-semibold text-gray-500 dark:text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#1F8FE0]" />
      Loading…
    </div>
  );
}
