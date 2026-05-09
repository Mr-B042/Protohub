import "dotenv/config";
import { sendInternalNewOrderEmail, sendNewOrderEmail, sendOrderAssignedEmail } from "../lib/mailer.js";
import { notifyOrderEvent } from "../lib/order-notifications.js";
import { supabase } from "../lib/supabase.js";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  round_robin_position?: number | null;
};

type PricingRow = {
  currency: "NGN" | "USD" | "GBP";
  selling_price: number;
  is_primary: boolean;
};

type PackageRow = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  currency: "NGN" | "USD" | "GBP";
  active: boolean;
  display_order: number;
};

type ProductRow = {
  id: string;
  name: string;
  active: boolean;
  pricings: PricingRow[] | null;
  packages: PackageRow[] | null;
};

type SeedOffer = {
  productId: string;
  productName: string;
  packageId: string | null;
  packageName: string | null;
  quantity: number;
  amount: number;
  currency: "NGN" | "USD" | "GBP";
};

type SeedOrder = {
  id: string;
  org_id: string;
  customer: string;
  phone: string;
  whatsapp: string;
  email: string | null;
  address: string;
  city: string;
  state: string;
  product_id: string;
  package_id: string | null;
  product_name: string;
  package_name: string | null;
  quantity: number;
  original_quantity: number;
  amount: number;
  original_amount: number;
  currency: "NGN" | "USD" | "GBP";
  status: "New";
  source: "TikTok" | "Facebook" | "WhatsApp" | "Website" | "Direct";
  location: string;
  assigned_rep_id: string;
  response: string;
  utm_source: string;
  utm_campaign: string;
  utm_medium: string;
  utm_content: string;
  utm_term: string;
  referrer: string;
  confirmation_checked: boolean;
  preferred_delivery: string | null;
  date: string;
  created_at: string;
  updated_at: string;
};

const COUNT = clampInteger(process.env.COUNT, 50, 1, 500);
const ORG_ID = process.env.ORG_ID?.trim() || null;
const DRY_RUN = readBool(process.env.DRY_RUN, false);
const EMIT_SIDE_EFFECTS = readBool(process.env.EMIT_SIDE_EFFECTS, false);

const SOURCES = ["TikTok", "Facebook", "WhatsApp", "Website", "Direct"] as const;
const FIRST_NAMES = [
  "Aisha", "Kemi", "Tunde", "Chinonso", "Ifeoma", "Segun", "Amaka", "Bola", "Uche", "Zainab",
  "Femi", "Ngozi", "David", "Blessing", "Ibrahim", "Adaeze", "Kunle", "Halima", "Seyi", "Emeka",
];
const LAST_NAMES = [
  "Okafor", "Balogun", "Adebayo", "Mohammed", "Eze", "Ogunleye", "Abdullahi", "Obi", "Adeyemi", "Nwosu",
  "Ibrahim", "Ojo", "Okeke", "Sule", "Lawal", "Onyeka", "Akinola", "Bassey", "Okon", "Bello",
];
const LOCATIONS = [
  { state: "Lagos", city: "Ikeja", areas: ["Allen Avenue", "Alausa", "Oregun", "Maryland"] },
  { state: "Lagos", city: "Lekki", areas: ["Chevron", "Jakande", "Ikate", "Lekki Phase 1"] },
  { state: "Abuja", city: "Wuse", areas: ["Wuse 2", "Jabi", "Gwarinpa", "Utako"] },
  { state: "Oyo", city: "Ibadan", areas: ["Bodija", "Challenge", "Akobo", "Ring Road"] },
  { state: "Rivers", city: "Port Harcourt", areas: ["GRA", "Rumuokoro", "Ada George", "Eliozu"] },
  { state: "Kano", city: "Kano", areas: ["Nasarawa", "Tarauni", "Fagge", "Gwale"] },
  { state: "Enugu", city: "Enugu", areas: ["Independence Layout", "Abakpa", "Trans Ekulu", "New Haven"] },
  { state: "Delta", city: "Asaba", areas: ["Okpanam", "Anwai", "Summit Road", "GRA"] },
];
const DELIVERY_CHOICES = ["Today", "Tomorrow", "Within 2 days", "Within 3 days"];

function clampInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function readBool(raw: string | undefined, fallback: boolean) {
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

function formatDisplayDate(value: Date) {
  return value.toLocaleDateString("en-NG", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
}

function makePhone(seed: number) {
  return `0803${String(1_000_000 + seed).padStart(7, "0")}`;
}

function resolveEmail(index: number, customer: string) {
  if (index % 3 !== 0) return null;
  const slug = customer.toLowerCase().replace(/[^a-z]+/g, ".");
  return `${slug}.${index + 1}@example.test`;
}

function buildOffers(products: ProductRow[]) {
  const offers: SeedOffer[] = [];

  for (const product of products) {
    const activePackages = (product.packages ?? [])
      .filter((pkg) => pkg.active)
      .sort((a, b) => a.display_order - b.display_order);

    if (activePackages.length > 0) {
      for (const pkg of activePackages) {
        offers.push({
          productId: product.id,
          productName: product.name,
          packageId: pkg.id,
          packageName: pkg.name,
          quantity: pkg.quantity,
          amount: Number(pkg.price),
          currency: pkg.currency,
        });
      }
      continue;
    }

    const pricings = product.pricings ?? [];
    const primaryPricing = pricings.find((pricing) => pricing.is_primary) ?? pricings[0];
    if (!primaryPricing) continue;

    for (const quantity of [1, 2, 3]) {
      offers.push({
        productId: product.id,
        productName: product.name,
        packageId: null,
        packageName: null,
        quantity,
        amount: Number(primaryPricing.selling_price) * quantity,
        currency: primaryPricing.currency,
      });
    }
  }

  return offers;
}

async function resolveOrgId() {
  if (ORG_ID) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", ORG_ID)
      .single();

    if (error || !data) {
      throw new Error(`Organization ${ORG_ID} not found.`);
    }

    return data.id as string;
  }

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("No organizations found.");
  if (data.length > 1) {
    const options = data.map((org) => `${org.name} (${org.id})`).join("\n  - ");
    throw new Error(`Multiple organizations found. Re-run with ORG_ID.\n  - ${options}`);
  }

  return data[0].id as string;
}

async function main() {
  const orgId = await resolveOrgId();

  const [{ data: org }, { data: users, error: usersError }, { data: products, error: productsError }] = await Promise.all([
    supabase.from("organizations").select("id, name").eq("id", orgId).single(),
    supabase
      .from("users")
      .select("id, name, email, role, active, round_robin_position")
      .eq("org_id", orgId)
      .eq("active", true)
      .order("round_robin_position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("products")
      .select(`
        id,
        name,
        active,
        pricings:product_pricings(currency, selling_price, is_primary),
        packages:product_packages(id, name, quantity, price, currency, active, display_order)
      `)
      .eq("org_id", orgId)
      .eq("active", true)
      .order("created_at", { ascending: true }),
  ]);

  if (!org) throw new Error(`Organization ${orgId} not found.`);
  if (usersError) throw new Error(usersError.message);
  if (productsError) throw new Error(productsError.message);

  const activeUsers = (users ?? []) as UserRow[];
  if (activeUsers.length === 0) {
    throw new Error(`No active users found for org ${orgId}.`);
  }

  const repPool = activeUsers.filter((user) => user.role === "Sales Rep");
  const creator =
    activeUsers.find((user) => ["Owner", "Admin", "Manager"].includes(user.role)) ??
    repPool[0] ??
    activeUsers[0];

  const assignableUsers = repPool.length > 0 ? repPool : [creator];
  const offers = buildOffers((products ?? []) as ProductRow[]);

  if (offers.length === 0) {
    throw new Error(`No active products with packages or pricing found for org ${orgId}.`);
  }

  const batchToken = Date.now().toString(36).toUpperCase().slice(-6);
  const phoneSeedBase = Number.parseInt(batchToken, 36) % 700_000;
  const createdBase = Date.now() - 6 * 24 * 60 * 60 * 1000;

  const orders: SeedOrder[] = [];
  const audits: Record<string, unknown>[] = [];

  for (let index = 0; index < COUNT; index += 1) {
    const firstName = randomItem(FIRST_NAMES);
    const lastName = randomItem(LAST_NAMES);
    const customer = `${firstName} ${lastName}`;
    const location = randomItem(LOCATIONS);
    const area = randomItem(location.areas);
    const offer = randomItem(offers);
    const source = randomItem([...SOURCES]);
    const assignedRep = assignableUsers[index % assignableUsers.length] as UserRow;
    const createdAt = new Date(createdBase + index * 2.5 * 60 * 60 * 1000 + Math.floor(Math.random() * 45 * 60 * 1000));
    const id = `${createdAt.getTime()}${String(index + 1).padStart(4, "0")}`;
    const phone = makePhone(phoneSeedBase + index);
    const email = resolveEmail(index, customer);
    const preferredDelivery = index % 4 === 0 ? randomItem([...DELIVERY_CHOICES]) : null;

    const order: SeedOrder = {
      id,
      org_id: orgId,
      customer,
      phone,
      whatsapp: phone,
      email,
      address: `${Math.floor(Math.random() * 120) + 3} ${area} Road`,
      city: location.city,
      state: location.state,
      product_id: offer.productId,
      package_id: offer.packageId,
      product_name: offer.productName,
      package_name: offer.packageName,
      quantity: offer.quantity,
      original_quantity: offer.quantity,
      amount: offer.amount,
      original_amount: offer.amount,
      currency: offer.currency,
      status: "New",
      source,
      location: `${location.city}, ${location.state}`,
      assigned_rep_id: assignedRep.id,
      response: "Awaiting first confirmation call",
      utm_source: source.toLowerCase(),
      utm_campaign: `mock-seed-${location.state.toLowerCase().replace(/\s+/g, "-")}`,
      utm_medium: source === "WhatsApp" ? "chat" : "social",
      utm_content: `batch-${batchToken.toLowerCase()}`,
      utm_term: `${offer.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-offer`,
      referrer: "https://mock-seed.local/orders",
      confirmation_checked: source !== "Direct",
      preferred_delivery: preferredDelivery,
      date: formatDisplayDate(createdAt),
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
    };

    orders.push(order);
    audits.push({
      order_id: id,
      org_id: orgId,
      changed_by: creator.id,
      from_status: null,
      to_status: "New",
      note: "Mock order seeded",
      created_at: new Date(createdAt.getTime() + 1_000).toISOString(),
    });
  }

  const preview = shuffle(orders).slice(0, Math.min(5, orders.length)).map((order) => ({
    id: order.id,
    customer: order.customer,
    product: order.product_name,
    package: order.package_name ?? "Manual quantity",
    quantity: order.quantity,
    amount: order.amount,
    status: order.status,
    rep: activeUsers.find((user) => user.id === order.assigned_rep_id)?.name ?? order.assigned_rep_id,
  }));

  console.log(`Org: ${org.name} (${orgId})`);
  console.log(`Creator for audit trail: ${creator.name} (${creator.role})`);
  console.log(`Assignable reps: ${assignableUsers.map((user) => user.name).join(", ")}`);
  console.log(`Offers available: ${offers.length}`);
  console.table(preview);

  if (DRY_RUN) {
    console.log(`Dry run complete. Would insert ${orders.length} mock orders.`);
    return;
  }

  const { error: orderInsertError } = await supabase
    .from("orders")
    .insert(orders);

  if (orderInsertError) {
    throw new Error(`Order insert failed: ${orderInsertError.message}`);
  }

  const { error: auditInsertError } = await supabase
    .from("order_audit")
    .insert(audits);

  if (auditInsertError) {
    throw new Error(`Order audit insert failed: ${auditInsertError.message}`);
  }

  if (EMIT_SIDE_EFFECTS) {
    for (const order of orders) {
      await notifyOrderEvent(orgId, {
        id: order.id,
        customer: order.customer,
        productName: order.product_name,
        assignedRepId: order.assigned_rep_id,
      }, "New");

      sendNewOrderEmail(orgId, {
        id: order.id,
        customer: order.customer,
        email: order.email,
        phone: order.phone,
        product_name: order.product_name,
        amount: order.amount,
        currency: order.currency,
        source: order.source,
      });

      sendInternalNewOrderEmail(orgId, {
        id: order.id,
        customer: order.customer,
        phone: order.phone,
        product_name: order.product_name,
        amount: order.amount,
        currency: order.currency,
        source: order.source,
        rep_name: creator.name,
      });

      if (order.assigned_rep_id !== creator.id) {
        sendOrderAssignedEmail(orgId, order.assigned_rep_id, {
          id: order.id,
          customer: order.customer,
          phone: order.phone,
          product_name: order.product_name,
          amount: order.amount,
          currency: order.currency,
          source: order.source,
        });
      }
    }
  }

  console.log(`Inserted ${orders.length} mock orders in status New.`);
  console.log(`Audit rows created: ${audits.length}.`);
  if (!EMIT_SIDE_EFFECTS) {
    console.log("Side effects skipped: no email, push, or in-app notifications were emitted.");
  }
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
