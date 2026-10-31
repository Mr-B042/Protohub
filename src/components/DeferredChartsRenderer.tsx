import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie,
  PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import type { DeferredChartsProps } from "./DeferredCharts";

const charts = {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie,
  PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
};

export default function DeferredChartsRenderer({ children }: DeferredChartsProps) {
  return <>{children(charts)}</>;
}
