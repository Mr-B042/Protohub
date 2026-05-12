import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

type CriticalKey = "products" | "orders" | "expenses" | "notifications" | "carts";

const DASHBOARD_ORDER_LIMIT = 5000;

router.get("/", async (req, res) => {
  const canReadExpenses = req.user!.role === "Owner" || req.user!.role === "Admin";

  const tasks: Record<CriticalKey, PromiseLike<unknown>> = {
    products: supabase
      .from("products")
      .select(`
        *,
        pricings: product_pricings(*),
        packages: product_packages(*)
      `)
      .eq("org_id", req.user!.orgId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      }),

    orders: supabase
      .from("orders")
      .select("*", { count: "exact" })
      .eq("org_id", req.user!.orgId)
      .order("created_at", { ascending: false })
      .range(0, DASHBOARD_ORDER_LIMIT - 1)
      .then(({ data, error, count }) => {
        if (error) throw error;
        return {
          data: data ?? [],
          total: count ?? 0,
          page: 1,
          pageSize: DASHBOARD_ORDER_LIMIT
        };
      }),

    expenses: canReadExpenses
      ? supabase
          .from("expenses")
          .select("*")
          .eq("org_id", req.user!.orgId)
          .order("date", { ascending: false })
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([]),

    notifications: supabase
      .from("system_notifications")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .or(`recipient_id.is.null,recipient_id.eq.${req.user!.id}`)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      }),

    carts: (() => {
      let query = supabase
        .from("abandoned_carts")
        .select("*")
        .eq("org_id", req.user!.orgId)
        .order("created_at", { ascending: false });
      if (req.user!.role === "Sales Rep") {
        query = query.eq("assigned_rep_id", req.user!.id);
      }
      return query.then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      });
    })()
  };

  const keys = Object.keys(tasks) as CriticalKey[];
  const settled = await Promise.allSettled(keys.map((key) => tasks[key]));

  const critical: Record<CriticalKey, unknown | null> = {
    products: null,
    orders: null,
    expenses: null,
    notifications: null,
    carts: null
  };
  const failures: CriticalKey[] = [];
  const errors: Partial<Record<CriticalKey, string>> = {};

  settled.forEach((result, index) => {
    const key = keys[index]!;
    if (result.status === "fulfilled") {
      critical[key] = result.value;
      return;
    }
    failures.push(key);
    errors[key] = result.reason instanceof Error ? result.reason.message : "Unknown error";
  });

  res.json({
    generatedAt: new Date().toISOString(),
    critical,
    failures,
    errors
  });
});

export default router;
