import { lazy, Suspense, type ReactNode } from "react";

export type ChartComponents = Pick<typeof import("recharts"),
  "Bar" | "CartesianGrid" | "Cell" | "ComposedChart" | "Legend" | "Line" |
  "LineChart" | "Pie" | "PieChart" | "ResponsiveContainer" | "Tooltip" | "XAxis" | "YAxis"
>;

export type DeferredChartsProps = {
  children: (charts: ChartComponents) => ReactNode;
};

const ChartRenderer = lazy(() => import("./DeferredChartsRenderer"));

// Chart code is needed only when a chart is visible. A local boundary keeps
// slower downloads from replacing the workspace or delaying the Orders table.
export function DeferredCharts({ children }: DeferredChartsProps) {
  return (
    <Suspense fallback={<div role="status" className="flex h-full min-h-[96px] items-center justify-center text-xs text-gray-500">Loading chart…</div>}>
      <ChartRenderer>{children}</ChartRenderer>
    </Suspense>
  );
}
