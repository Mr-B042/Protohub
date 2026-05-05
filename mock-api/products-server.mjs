import http from "node:http";

const PORT = Number(process.env.PORT || 4010);
const HOST = process.env.HOST || "127.0.0.1";

const productCurrencies = new Set(["NGN", "GHS", "USD", "GBP", "EUR"]);
const productRoles = new Set(["Main", "Cross-sell", "Free Gift"]);
const nigeriaStates = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara"
];

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const nowDisplayDate = () =>
  new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

const makeSku = (name) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.slice(0, 4).toUpperCase());

  return `${parts.join("-") || "PRD"}-${Math.floor(100 + Math.random() * 900)}`;
};

const defaultBonusConfig = () => ({
  baseDelivered: [
    { id: "base-3", quantity: 3, amount: 200 },
    { id: "base-5", quantity: 5, amount: 200 },
    { id: "base-7", quantity: 7, amount: 200 },
    { id: "base-10", quantity: 10, amount: 200 },
    { id: "base-15", quantity: 15, amount: 200 },
    { id: "base-20", quantity: 20, amount: 200 }
  ],
  upgradeBonuses: [
    { id: "up-3-5", fromQty: 3, toQty: 5, amount: 1000 },
    { id: "up-3-7", fromQty: 3, toQty: 7, amount: 1500 },
    { id: "up-5-7", fromQty: 5, toQty: 7, amount: 1500 },
    { id: "up-7-10", fromQty: 7, toQty: 10, amount: 2000 }
  ],
  manualOrderBonuses: [
    { id: "manual-3", quantity: 3, amount: 500 },
    { id: "manual-5", quantity: 5, amount: 800 }
  ],
  crossSellPercent: 5,
  crossSellFixed: 0,
  freeGiftBonus: 0,
  aovBonuses: [
    { id: "aov-33", threshold: 33000, amount: 10000 },
    { id: "aov-35", threshold: 35000, amount: 20000 }
  ],
  deliveryRateBonuses: [
    { id: "dr-60", ratePercent: 60, amount: 5000 },
    { id: "dr-70", ratePercent: 70, amount: 10000 }
  ],
  upgradeRequiresMinDeliveryRate: 60,
  aovRequiresMinDeliveryRate: 60,
  deliveryRateMinOrders: 50,
  poorDeliveryRatePercent: 55
});

const createSeedProducts = () => [
  {
    id: "prod-edge-brusher",
    name: "Edge Brusher Max",
    description: "Hair styling ecommerce SKU used for audit flows.",
    sku: "EDGE-BRUSHER-001",
    active: true,
    reorderPoint: 20,
    warehouseStock: 120,
    agentStock: 30,
    unitsSold: 18,
    pricings: [{ currency: "NGN", sellingPrice: 18000, unitCost: 6200, primary: true }],
    packages: [
      {
        id: "pkg-edge-single",
        name: "Single Pack",
        description: "1 Edge Brusher Max",
        quantity: 1,
        price: 18000,
        currency: "NGN",
        displayOrder: 1,
        active: true
      },
      {
        id: "pkg-edge-double",
        name: "Double Pack",
        description: "2 Edge Brusher Max units",
        quantity: 2,
        price: 34000,
        currency: "NGN",
        displayOrder: 2,
        active: true
      }
    ],
    packageDescription: "Packages determine the quantity, customer-facing offer, and revenue on order creation.",
    createdAt: "May 2, 2026",
    role: "Main",
    availableStates: [],
    bonusConfig: defaultBonusConfig(),
    crossSellProductIds: ["prod-satin-bonnet"],
    crossSellPriceOverrides: { "prod-satin-bonnet": 4500 },
    crossSellStateRestrictions: { "prod-satin-bonnet": ["Lagos", "Ogun"] },
    freeGiftProductIds: ["prod-sample-oil"],
    freeGiftStateRestrictions: { "prod-sample-oil": ["Lagos"] },
    formCustomText: "Order now and unlock bundle savings."
  },
  {
    id: "prod-demo-blender",
    name: "Demo Audit Blender",
    description: "Demo product used to unlock package and delivery flows.",
    sku: "DEMO-AUDIT-BLENDER",
    active: true,
    reorderPoint: 10,
    warehouseStock: 30,
    agentStock: 10,
    unitsSold: 4,
    pricings: [{ currency: "NGN", sellingPrice: 12000, unitCost: 4000, primary: true }],
    packages: [
      {
        id: "pkg-demo-starter",
        name: "Demo Starter Pack",
        description: "2 blender units",
        quantity: 2,
        price: 22000,
        currency: "NGN",
        displayOrder: 1,
        active: true
      }
    ],
    packageDescription: "Audit package used to test quantities, totals, and agent assignment.",
    createdAt: "May 3, 2026",
    role: "Main",
    availableStates: [],
    bonusConfig: defaultBonusConfig()
  },
  {
    id: "prod-satin-bonnet",
    name: "Satin Night Bonnet",
    description: "Cross-sell product seeded for add-on testing.",
    sku: "SATIN-BONNET-001",
    active: true,
    reorderPoint: 12,
    warehouseStock: 65,
    agentStock: 6,
    unitsSold: 11,
    pricings: [{ currency: "NGN", sellingPrice: 5000, unitCost: 1600, primary: true }],
    packages: [
      {
        id: "pkg-bonnet-single",
        name: "Single Bonnet",
        description: "1 satin bonnet",
        quantity: 1,
        price: 5000,
        currency: "NGN",
        displayOrder: 1,
        active: true
      }
    ],
    packageDescription: "Used as a simple cross-sell attachment in mock flows.",
    createdAt: "May 3, 2026",
    role: "Cross-sell",
    canBeCrossSell: true,
    availableStates: ["Lagos", "Ogun", "Oyo"],
    bonusConfig: defaultBonusConfig()
  },
  {
    id: "prod-sample-oil",
    name: "Thank You Sample Oil",
    description: "Free gift product seeded for reward testing.",
    sku: "SAMPLE-OIL-001",
    active: true,
    reorderPoint: 5,
    warehouseStock: 150,
    agentStock: 0,
    unitsSold: 20,
    pricings: [{ currency: "NGN", sellingPrice: 1000, unitCost: 250, primary: true }],
    packages: [
      {
        id: "pkg-oil-single",
        name: "Sample Oil",
        description: "1 sample bottle",
        quantity: 1,
        price: 1000,
        currency: "NGN",
        displayOrder: 1,
        active: true
      }
    ],
    packageDescription: "Useful when testing auto-gifts and product attachments.",
    createdAt: "May 3, 2026",
    role: "Free Gift",
    canBeFreeGift: true,
    availableStates: [],
    bonusConfig: defaultBonusConfig()
  }
];

const makeOpeningStockMovements = (products) =>
  products
    .filter((product) => product.warehouseStock > 0)
    .map((product) => ({
      id: makeId("mov"),
      date: new Date().toISOString(),
      productId: product.id,
      productName: product.name,
      type: "Stock Added",
      qty: product.warehouseStock,
      balanceAfter: product.warehouseStock,
      by: "System Seed",
      note: "Opening stock seed"
    }));

const createState = () => {
  const products = createSeedProducts();
  return {
    products,
    stockMovements: makeOpeningStockMovements(products)
  };
};

let state = createState();

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, jsonHeaders);
  res.end(JSON.stringify(payload, null, 2));
};

const sendError = (res, statusCode, message, details) => {
  sendJson(res, statusCode, {
    ok: false,
    message,
    ...(details ? { details } : {})
  });
};

const parseJsonBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error.message}`);
  }
};

const toSegments = (pathname) => pathname.split("/").filter(Boolean);
const findProduct = (productId) => state.products.find((product) => product.id === productId);
const unique = (values) => Array.from(new Set(values));
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const numberOrDefault = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const ensureProduct = (res, productId) => {
  const product = findProduct(productId);
  if (!product) {
    sendError(res, 404, `Product "${productId}" was not found.`);
    return null;
  }

  return product;
};

const ensureCurrency = (currency) => {
  if (!productCurrencies.has(currency)) {
    throw new Error(`Unsupported currency "${currency}".`);
  }
};

const ensureRole = (role) => {
  if (!productRoles.has(role)) {
    throw new Error(`Unsupported role "${role}".`);
  }
};

const normalizeStateList = (states) => {
  if (!Array.isArray(states)) {
    throw new Error("availableStates must be an array.");
  }

  const invalidStates = states.filter((state) => !nigeriaStates.includes(state));
  if (invalidStates.length > 0) {
    throw new Error(`Unknown states: ${invalidStates.join(", ")}.`);
  }

  return unique(states);
};

const normalizeQuantityRules = (rules, kind) => {
  if (!Array.isArray(rules)) {
    throw new Error(`${kind} must be an array.`);
  }

  return rules.map((rule) => ({
    id: typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : makeId("bonus"),
    quantity: Math.max(0, numberOrDefault(rule.quantity, 0)),
    amount: Math.max(0, numberOrDefault(rule.amount, 0))
  }));
};

const normalizeUpgradeRules = (rules) => {
  if (!Array.isArray(rules)) {
    throw new Error("upgradeBonuses must be an array.");
  }

  return rules.map((rule) => ({
    id: typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : makeId("bonus"),
    fromQty: Math.max(0, numberOrDefault(rule.fromQty, 0)),
    toQty: Math.max(0, numberOrDefault(rule.toQty, 0)),
    amount: Math.max(0, numberOrDefault(rule.amount, 0))
  }));
};

const normalizeAovRules = (rules) => {
  if (!Array.isArray(rules)) {
    throw new Error("aovBonuses must be an array.");
  }

  return rules.map((rule) => ({
    id: typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : makeId("bonus"),
    threshold: Math.max(0, numberOrDefault(rule.threshold, 0)),
    amount: Math.max(0, numberOrDefault(rule.amount, 0))
  }));
};

const normalizeDeliveryRateRules = (rules) => {
  if (!Array.isArray(rules)) {
    throw new Error("deliveryRateBonuses must be an array.");
  }

  return rules.map((rule) => ({
    id: typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : makeId("bonus"),
    ratePercent: Math.max(0, numberOrDefault(rule.ratePercent, 0)),
    amount: Math.max(0, numberOrDefault(rule.amount, 0))
  }));
};

const normalizePricing = (input, options = {}) => {
  if (!isPlainObject(input)) {
    throw new Error("pricing must be an object.");
  }

  const currency = String(input.currency || "").trim().toUpperCase();
  ensureCurrency(currency);

  const sellingPrice = numberOrDefault(input.sellingPrice, NaN);
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    throw new Error("sellingPrice must be greater than zero.");
  }

  const unitCost = Math.max(0, numberOrDefault(input.unitCost, 0));

  return {
    currency,
    sellingPrice,
    unitCost,
    primary: Boolean(options.forcePrimary ?? input.primary)
  };
};

const normalizePackage = (input, current = {}) => {
  if (!isPlainObject(input)) {
    throw new Error("package payload must be an object.");
  }

  const name = input.name === undefined ? current.name : String(input.name || "").trim();
  if (!name) {
    throw new Error("Package name is required.");
  }

  const currency = String(input.currency ?? current.currency ?? "NGN").trim().toUpperCase();
  ensureCurrency(currency);

  return {
    id: current.id ?? makeId("pkg"),
    name,
    description: input.description === undefined ? current.description ?? "" : String(input.description || "").trim(),
    quantity: Math.max(1, numberOrDefault(input.quantity, current.quantity ?? 1)),
    price: Math.max(0, numberOrDefault(input.price, current.price ?? 0)),
    currency,
    displayOrder: Math.max(1, numberOrDefault(input.displayOrder, current.displayOrder ?? 1)),
    active: input.active === undefined ? current.active ?? true : Boolean(input.active)
  };
};

const normalizeBonusConfig = (input, current) => {
  if (!isPlainObject(input)) {
    throw new Error("bonus config payload must be an object.");
  }

  const next = deepClone(current ?? defaultBonusConfig());

  if (input.baseDelivered !== undefined) next.baseDelivered = normalizeQuantityRules(input.baseDelivered, "baseDelivered");
  if (input.upgradeBonuses !== undefined) next.upgradeBonuses = normalizeUpgradeRules(input.upgradeBonuses);
  if (input.manualOrderBonuses !== undefined) next.manualOrderBonuses = normalizeQuantityRules(input.manualOrderBonuses, "manualOrderBonuses");
  if (input.aovBonuses !== undefined) next.aovBonuses = normalizeAovRules(input.aovBonuses);
  if (input.deliveryRateBonuses !== undefined) next.deliveryRateBonuses = normalizeDeliveryRateRules(input.deliveryRateBonuses);

  const numericKeys = [
    "crossSellPercent",
    "crossSellFixed",
    "freeGiftBonus",
    "upgradeRequiresMinDeliveryRate",
    "aovRequiresMinDeliveryRate",
    "deliveryRateMinOrders",
    "poorDeliveryRatePercent"
  ];

  for (const key of numericKeys) {
    if (input[key] !== undefined) {
      next[key] = Math.max(0, numberOrDefault(input[key], next[key]));
    }
  }

  return next;
};

const normalizeRelationIds = (productId, ids, label) => {
  if (!Array.isArray(ids)) {
    throw new Error(`${label} must be an array of product ids.`);
  }

  const nextIds = unique(ids);
  const missing = nextIds.filter((id) => id === productId || !findProduct(id));
  if (missing.length > 0) {
    throw new Error(`${label} contains invalid product ids: ${missing.join(", ")}.`);
  }

  return nextIds;
};

const normalizeRelationObject = (productId, value, validator) => {
  if (!isPlainObject(value)) {
    throw new Error("Relation overrides must be objects.");
  }

  const next = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (key === productId || !findProduct(key)) {
      throw new Error(`Invalid related product id "${key}".`);
    }

    next[key] = validator(rawValue, key);
  }

  return next;
};

const cleanDeletedReferences = (product, deletedId) => {
  const next = {
    ...product,
    crossSellProductIds: (product.crossSellProductIds ?? []).filter((id) => id !== deletedId),
    freeGiftProductIds: (product.freeGiftProductIds ?? []).filter((id) => id !== deletedId)
  };

  const cleanObjectKeys = (value) => {
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== deletedId));
  };

  next.crossSellPriceOverrides = cleanObjectKeys(product.crossSellPriceOverrides);
  next.crossSellStateRestrictions = cleanObjectKeys(product.crossSellStateRestrictions);
  next.freeGiftStateRestrictions = cleanObjectKeys(product.freeGiftStateRestrictions);

  return next;
};

const duplicateName = (sourceName) => {
  const baseName = `${sourceName} (Copy)`;
  let candidate = baseName;
  let suffix = 2;

  while (state.products.some((product) => product.name.toLowerCase() === candidate.toLowerCase())) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const cloneBonusConfig = (bonusConfig) => {
  if (!bonusConfig) {
    return undefined;
  }

  return {
    ...bonusConfig,
    baseDelivered: bonusConfig.baseDelivered.map((rule) => ({ ...rule, id: makeId("bonus") })),
    upgradeBonuses: bonusConfig.upgradeBonuses.map((rule) => ({ ...rule, id: makeId("bonus") })),
    manualOrderBonuses: bonusConfig.manualOrderBonuses.map((rule) => ({ ...rule, id: makeId("bonus") })),
    aovBonuses: bonusConfig.aovBonuses.map((rule) => ({ ...rule, id: makeId("bonus") })),
    deliveryRateBonuses: bonusConfig.deliveryRateBonuses.map((rule) => ({ ...rule, id: makeId("bonus") }))
  };
};

const summarizeProducts = (products) => ({
  totalProducts: products.length,
  activeProducts: products.filter((product) => product.active).length,
  inactiveProducts: products.filter((product) => !product.active).length,
  totalWarehouseStock: products.reduce((sum, product) => sum + product.warehouseStock, 0),
  totalAgentStock: products.reduce((sum, product) => sum + product.agentStock, 0),
  totalUnitsSold: products.reduce((sum, product) => sum + product.unitsSold, 0)
});

const withPrimaryPricing = (pricings) => {
  const hasPrimary = pricings.some((pricing) => pricing.primary);
  if (hasPrimary) {
    return pricings;
  }

  return pricings.map((pricing, index) => ({
    ...pricing,
    primary: index === 0
  }));
};

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendError(res, 400, "Invalid request.");
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const segments = toSegments(url.pathname);

  try {
    if (req.method === "GET" && segments.length === 0) {
      sendJson(res, 200, {
        ok: true,
        message: "Protohub mock product API is running.",
        docs: {
          health: "/health",
          reset: "/api/mock/reset",
          products: "/api/products"
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        status: "healthy",
        port: PORT,
        summary: summarizeProducts(state.products)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/mock/reset") {
      state = createState();
      sendJson(res, 200, {
        ok: true,
        message: "Mock product dataset reset.",
        summary: summarizeProducts(state.products)
      });
      return;
    }

    if (segments[0] === "api" && segments[1] === "products" && segments.length === 2) {
      if (req.method === "GET") {
        const activeFilter = url.searchParams.get("active");
        const roleFilter = url.searchParams.get("role");
        const query = (url.searchParams.get("q") || "").trim().toLowerCase();

        let products = [...state.products];
        if (activeFilter === "true") products = products.filter((product) => product.active);
        if (activeFilter === "false") products = products.filter((product) => !product.active);
        if (roleFilter) products = products.filter((product) => product.role === roleFilter);
        if (query) {
          products = products.filter((product) =>
            [product.name, product.description, product.sku].some((value) => String(value || "").toLowerCase().includes(query))
          );
        }

        sendJson(res, 200, {
          ok: true,
          total: products.length,
          summary: summarizeProducts(products),
          products
        });
        return;
      }

      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        const name = String(body.name || "").trim();
        if (!name) {
          sendError(res, 400, "Product name is required.");
          return;
        }

        const pricing = normalizePricing(body.pricing, { forcePrimary: true });
        const openingStock = Math.max(0, numberOrDefault(body.openingStock, 0));
        const availableStates = body.availableStates === undefined ? [] : normalizeStateList(body.availableStates);
        const role = body.role === undefined ? "Main" : String(body.role);
        ensureRole(role);

        const product = {
          id: makeId("prod"),
          name,
          description: String(body.description || "").trim(),
          sku: String(body.sku || "").trim() || makeSku(name),
          active: body.active === undefined ? true : Boolean(body.active),
          reorderPoint: Math.max(0, numberOrDefault(body.reorderPoint, 0)),
          warehouseStock: openingStock,
          agentStock: 0,
          unitsSold: 0,
          pricings: [pricing],
          packages: Array.isArray(body.packages) ? body.packages.map((item) => normalizePackage(item)) : [],
          packageDescription: String(body.packageDescription || "").trim(),
          createdAt: nowDisplayDate(),
          availableStates,
          bonusConfig: normalizeBonusConfig(body.bonusConfig ?? {}, defaultBonusConfig()),
          role,
          canBeCrossSell: Boolean(body.canBeCrossSell),
          canBeFreeGift: Boolean(body.canBeFreeGift),
          formCustomText: String(body.formCustomText || "").trim()
        };

        state.products.push(product);
        if (openingStock > 0) {
          state.stockMovements.unshift({
            id: makeId("mov"),
            date: new Date().toISOString(),
            productId: product.id,
            productName: product.name,
            type: "Stock Added",
            qty: openingStock,
            balanceAfter: openingStock,
            by: "API User",
            note: "Opening stock"
          });
        }

        sendJson(res, 201, {
          ok: true,
          message: `Product "${product.name}" created.`,
          product
        });
        return;
      }
    }

    if (segments[0] === "api" && segments[1] === "products" && segments.length >= 3) {
      const productId = segments[2];
      const product = ensureProduct(res, productId);
      if (!product) {
        return;
      }

      if (segments.length === 3) {
        if (req.method === "GET") {
          const stockMovements = state.stockMovements.filter((movement) => movement.productId === productId);
          sendJson(res, 200, {
            ok: true,
            product,
            stockMovements
          });
          return;
        }

        if (req.method === "PATCH") {
          const body = await parseJsonBody(req);

          if (body.name !== undefined && !String(body.name || "").trim()) {
            sendError(res, 400, "Product name cannot be empty.");
            return;
          }

          if (body.role !== undefined) {
            ensureRole(String(body.role));
          }

          product.name = body.name === undefined ? product.name : String(body.name).trim();
          product.description = body.description === undefined ? product.description : String(body.description || "").trim();
          product.sku = body.sku === undefined ? product.sku : String(body.sku || "").trim() || product.sku;
          product.active = body.active === undefined ? product.active : Boolean(body.active);
          product.reorderPoint = body.reorderPoint === undefined ? product.reorderPoint : Math.max(0, numberOrDefault(body.reorderPoint, product.reorderPoint));
          product.packageDescription = body.packageDescription === undefined ? product.packageDescription : String(body.packageDescription || "").trim();
          product.role = body.role === undefined ? product.role : String(body.role);
          product.formCustomText = body.formCustomText === undefined ? product.formCustomText : String(body.formCustomText || "").trim();
          if (body.canBeCrossSell !== undefined) product.canBeCrossSell = Boolean(body.canBeCrossSell);
          if (body.canBeFreeGift !== undefined) product.canBeFreeGift = Boolean(body.canBeFreeGift);

          sendJson(res, 200, {
            ok: true,
            message: `Product "${product.name}" updated.`,
            product
          });
          return;
        }

        if (req.method === "DELETE") {
          state.products = state.products
            .filter((item) => item.id !== productId)
            .map((item) => cleanDeletedReferences(item, productId));
          state.stockMovements = state.stockMovements.filter((movement) => movement.productId !== productId);

          sendJson(res, 200, {
            ok: true,
            message: `Product "${product.name}" deleted.`,
            deletedProductId: productId
          });
          return;
        }
      }

      if (segments[3] === "pricings") {
        if (segments.length === 4 && req.method === "POST") {
          const body = await parseJsonBody(req);
          const pricing = normalizePricing(body);

          if (product.pricings.some((item) => item.currency === pricing.currency)) {
            sendError(res, 409, `Pricing for "${pricing.currency}" already exists on this product.`);
            return;
          }

          if (pricing.primary) {
            product.pricings = product.pricings.map((item) => ({ ...item, primary: false }));
          }

          product.pricings.push({
            ...pricing,
            primary: pricing.primary || product.pricings.length === 0
          });
          product.pricings = withPrimaryPricing(product.pricings);

          sendJson(res, 201, {
            ok: true,
            message: `${pricing.currency} pricing added.`,
            product
          });
          return;
        }

        if (segments.length === 5) {
          const currency = String(segments[4]).toUpperCase();
          const pricing = product.pricings.find((item) => item.currency === currency);
          if (!pricing) {
            sendError(res, 404, `Pricing "${currency}" was not found on this product.`);
            return;
          }

          if (req.method === "PATCH") {
            const body = await parseJsonBody(req);

            if (body.sellingPrice !== undefined) {
              const sellingPrice = numberOrDefault(body.sellingPrice, NaN);
              if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
                sendError(res, 400, "sellingPrice must be greater than zero.");
                return;
              }

              pricing.sellingPrice = sellingPrice;
            }

            if (body.unitCost !== undefined) {
              pricing.unitCost = Math.max(0, numberOrDefault(body.unitCost, pricing.unitCost));
            }

            if (body.primary === true) {
              product.pricings = product.pricings.map((item) => ({
                ...item,
                primary: item.currency === currency
              }));
            } else {
              product.pricings = withPrimaryPricing(product.pricings);
            }

            sendJson(res, 200, {
              ok: true,
              message: `${currency} pricing updated.`,
              product
            });
            return;
          }

          if (req.method === "DELETE") {
            if (pricing.primary) {
              sendError(res, 409, "Primary pricing cannot be deleted. Make another currency primary first.");
              return;
            }

            product.pricings = product.pricings.filter((item) => item.currency !== currency);
            sendJson(res, 200, {
              ok: true,
              message: `${currency} pricing removed.`,
              product
            });
            return;
          }
        }
      }

      if (segments[3] === "packages") {
        if (segments.length === 4 && req.method === "POST") {
          const body = await parseJsonBody(req);
          const nextPackage = normalizePackage(body);
          product.packages.push(nextPackage);

          sendJson(res, 201, {
            ok: true,
            message: `Package "${nextPackage.name}" added.`,
            product
          });
          return;
        }

        if (segments.length === 5) {
          const packageId = segments[4];
          const currentPackage = product.packages.find((item) => item.id === packageId);
          if (!currentPackage) {
            sendError(res, 404, `Package "${packageId}" was not found on this product.`);
            return;
          }

          if (req.method === "PATCH") {
            const body = await parseJsonBody(req);
            const nextPackage = normalizePackage(body, currentPackage);
            product.packages = product.packages.map((item) => (item.id === packageId ? nextPackage : item));

            sendJson(res, 200, {
              ok: true,
              message: `Package "${nextPackage.name}" updated.`,
              product
            });
            return;
          }

          if (req.method === "DELETE") {
            product.packages = product.packages.filter((item) => item.id !== packageId);
            sendJson(res, 200, {
              ok: true,
              message: `Package "${currentPackage.name}" deleted.`,
              product
            });
            return;
          }
        }
      }

      if (segments.length === 4 && segments[3] === "stock-adjustments" && req.method === "POST") {
        const body = await parseJsonBody(req);
        const change = numberOrDefault(body.change, 0);

        if (change === 0) {
          sendError(res, 400, "change must be a positive or negative number.");
          return;
        }

        const nextBalance = Math.max(0, product.warehouseStock + change);
        const actualChange = nextBalance - product.warehouseStock;
        if (actualChange === 0) {
          sendError(res, 409, "Stock is already at zero. This adjustment has no effect.");
          return;
        }

        product.warehouseStock = nextBalance;

        const movement = {
          id: makeId("mov"),
          date: new Date().toISOString(),
          productId: product.id,
          productName: product.name,
          type: actualChange > 0 ? "Stock Added" : "Correction",
          qty: actualChange,
          balanceAfter: nextBalance,
          by: String(body.by || "API User"),
          note: String(body.note || (actualChange > 0 ? "Manual stock increase" : "Manual stock reduction"))
        };

        state.stockMovements.unshift(movement);

        sendJson(res, 200, {
          ok: true,
          message: `Warehouse stock updated to ${nextBalance}.`,
          movement,
          product
        });
        return;
      }

      if (segments.length === 4 && segments[3] === "clone" && req.method === "POST") {
        const body = await parseJsonBody(req);
        const name = body.name ? String(body.name).trim() : duplicateName(product.name);
        if (!name) {
          sendError(res, 400, "Clone name cannot be empty.");
          return;
        }

        const clone = {
          ...deepClone(product),
          id: makeId("prod"),
          name,
          sku: String(body.sku || "").trim() || makeSku(name),
          warehouseStock: 0,
          agentStock: 0,
          unitsSold: 0,
          createdAt: nowDisplayDate(),
          pricings: product.pricings.map((pricing) => ({ ...pricing })),
          packages: product.packages.map((item) => ({ ...item, id: makeId("pkg") })),
          availableStates: Array.isArray(product.availableStates) ? [...product.availableStates] : [],
          bonusConfig: cloneBonusConfig(product.bonusConfig),
          crossSellProductIds: product.crossSellProductIds ? [...product.crossSellProductIds] : undefined,
          freeGiftProductIds: product.freeGiftProductIds ? [...product.freeGiftProductIds] : undefined,
          crossSellPriceOverrides: product.crossSellPriceOverrides ? { ...product.crossSellPriceOverrides } : undefined,
          crossSellStateRestrictions: product.crossSellStateRestrictions ? deepClone(product.crossSellStateRestrictions) : undefined,
          freeGiftStateRestrictions: product.freeGiftStateRestrictions ? deepClone(product.freeGiftStateRestrictions) : undefined
        };

        state.products.unshift(clone);

        sendJson(res, 201, {
          ok: true,
          message: `Product cloned as "${clone.name}".`,
          product: clone
        });
        return;
      }

      if (segments.length === 4 && segments[3] === "toggle-active" && req.method === "POST") {
        product.active = !product.active;
        sendJson(res, 200, {
          ok: true,
          message: `Product "${product.name}" is now ${product.active ? "active" : "inactive"}.`,
          product
        });
        return;
      }

      if (segments.length === 4 && segments[3] === "state-availability" && req.method === "PUT") {
        const body = await parseJsonBody(req);
        product.availableStates = normalizeStateList(body.availableStates ?? []);

        sendJson(res, 200, {
          ok: true,
          message: "State availability updated.",
          product
        });
        return;
      }

      if (segments.length === 4 && segments[3] === "bonus-config" && req.method === "PUT") {
        const body = await parseJsonBody(req);
        product.bonusConfig = normalizeBonusConfig(body, product.bonusConfig);

        sendJson(res, 200, {
          ok: true,
          message: "Bonus configuration updated.",
          product
        });
        return;
      }

      if (segments.length === 4 && segments[3] === "relations" && req.method === "PUT") {
        const body = await parseJsonBody(req);

        if (body.role !== undefined) {
          ensureRole(String(body.role));
          product.role = String(body.role);
        }

        if (body.canBeCrossSell !== undefined) {
          product.canBeCrossSell = Boolean(body.canBeCrossSell);
        }

        if (body.canBeFreeGift !== undefined) {
          product.canBeFreeGift = Boolean(body.canBeFreeGift);
        }

        if (body.crossSellProductIds !== undefined) {
          product.crossSellProductIds = normalizeRelationIds(product.id, body.crossSellProductIds, "crossSellProductIds");
        }

        if (body.freeGiftProductIds !== undefined) {
          product.freeGiftProductIds = normalizeRelationIds(product.id, body.freeGiftProductIds, "freeGiftProductIds");
        }

        if (body.crossSellPriceOverrides !== undefined) {
          product.crossSellPriceOverrides = normalizeRelationObject(
            product.id,
            body.crossSellPriceOverrides,
            (rawValue) => Math.max(0, numberOrDefault(rawValue, 0))
          );
        }

        if (body.crossSellStateRestrictions !== undefined) {
          product.crossSellStateRestrictions = normalizeRelationObject(
            product.id,
            body.crossSellStateRestrictions,
            (rawValue) => normalizeStateList(rawValue)
          );
        }

        if (body.freeGiftStateRestrictions !== undefined) {
          product.freeGiftStateRestrictions = normalizeRelationObject(
            product.id,
            body.freeGiftStateRestrictions,
            (rawValue) => normalizeStateList(rawValue)
          );
        }

        sendJson(res, 200, {
          ok: true,
          message: "Product relations updated.",
          product
        });
        return;
      }
    }

    sendError(res, 404, `No route matched ${req.method} ${url.pathname}`);
  } catch (error) {
    sendError(res, 400, error.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mock product API running at http://${HOST}:${PORT}`);
});
