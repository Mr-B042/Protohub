import type { EmDesigner, EmDesignerProduct, EmFlowNode } from "../../lib/api";
import { buildStarterDesign, fillProduct, type CampaignFields } from "../../lib/email-render";
import { DEFAULT_SETTINGS, newId, type AutoDraft } from "./automation-model";
import { priceText } from "./wizard-model";

/**
 * Autopilot (Bright, 9 Nov 2026: "start working non stop… the right email
 * for each product… draft if not available"). Builds the automations that
 * keep email marketing running by itself, from the business's own products:
 *  - for everyone: Welcome (new subscriber) and Win-Back (60 days quiet);
 *  - for each product that sells: After Delivery (thanks + use, how is it
 *    going, a matching product) and Cart Reminder (1 hour, then next day).
 * A flow goes live only when its emails have a product photo and an order
 * page; otherwise it is saved as a draft that says what is missing.
 */

export type PlanItem = { key: string; draft: AutoDraft; ready: boolean; needs: string[]; productName: string | null };

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  // Customers order every day: send every day, 8am to 8pm Lagos.
  sendWindow: { on: true, from: 8, to: 20, days: [0, 1, 2, 3, 4, 5, 6] }
};

function fields(designer: EmDesigner, product: EmDesignerProduct | undefined): CampaignFields {
  return {
    brand: designer.sender.fromName || "Our Store", goal: "retention", offerType: "custom", productId: product?.id ?? "", productName: product?.name ?? "",
    productImage: product?.image ?? "", productLink: product?.links[0]?.url ?? "", productPrice: priceText(product), offerOn: false, offerTitle: "", offerBenefit: ""
  };
}
const wait = (amount: number, unit: "hours" | "days" = "days"): EmFlowNode => ({ id: newId("w"), type: "wait", amount, unit });
function email(name: string, starter: string, designer: EmDesigner, product: EmDesignerProduct | undefined, subject: string, preheader: string): EmFlowNode {
  const f = fields(designer, product);
  return {
    id: newId("e"), type: "email", name, campaignId: null,
    email: { subject: fillProduct(subject, f.productName), preheader, design: buildStarterDesign(starter, f), productId: product?.id ?? null, thumbnailUrl: product?.image || null }
  };
}
const needsOf = (product: EmDesignerProduct | undefined) => [
  ...(!product?.image ? ["a product photo (Products & Stock › gallery)"] : []),
  ...(!product?.links.length ? ["an order page link (Tracking Hub › landing page)"] : [])
];

function draft(name: string, description: string, template: string, goal: string, stage: AutoDraft["stage"], trigger: AutoDraft["trigger"], nodes: EmFlowNode[], exitOnPurchase: boolean): AutoDraft {
  return {
    id: null, status: "draft", active: true, name, description, template, goal, trigger, audience: { source: "all" },
    enrollment: { on: false, match: "all", conditions: [] },
    settings: { ...SETTINGS, exit: { ...SETTINGS.exit, onPurchase: exitOnPurchase } },
    workflow: { nodes }, stage
  };
}

/** The whole plan. `sales` = delivered-or-placed orders per product in the last 60 days. */
export function autopilotPlan(designer: EmDesigner, sales: Array<{ productId: string; orders: number }>): PlanItem[] {
  const count = new Map(sales.map((row) => [row.productId, row.orders]));
  const products = designer.products.filter((row) => (count.get(row.id) ?? 0) > 0).sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));
  const best = products.find((row) => row.image && row.links.length) ?? products[0];
  // Products with an order page but no sales yet: drafts, ready to switch on later.
  const quiet = designer.products.filter((row) => !(count.get(row.id) ?? 0) && row.links.length);
  const plan: PlanItem[] = [];

  const storeNeeds = needsOf(best);
  plan.push({
    key: "welcome", productName: null, ready: !storeNeeds.length, needs: storeNeeds,
    draft: draft("Autopilot: Welcome", "New subscribers get a welcome, then the best seller.", "welcome", "welcome", "acquisition", { kind: "new_subscriber" }, [
      email("Email 1: Welcome", "welcome_email", designer, best, "Welcome, {{First Name}}! 🎉", "Thanks for joining us"),
      wait(3),
      email("Email 2: Our Best Seller", "product_collection", designer, best, "Our customers' favourite: {{Product}}", "Order today, pay on delivery")
    ], true)
  });
  plan.push({
    key: "win_back", productName: null, ready: !storeNeeds.length, needs: storeNeeds,
    draft: draft("Autopilot: Win-Back", "Customers with no delivery for 60 days.", "win_back", "winback", "winback", { kind: "inactive", inactiveDays: 60 }, [
      email("Email 1: We Miss You", "win_back_offer", designer, best, "We miss you, {{First Name}}", "Here is a reason to come back"),
      wait(7),
      { id: newId("c"), type: "condition", name: "Did the customer order again?", check: { kind: "placed_order" }, yes: [], no: [
        email("Email 2: Still Here For You", "still_interested", designer, best, "Still thinking about {{Product}}?", "It's still available")
      ] }
    ], true)
  });

  for (const product of [...products, ...quiet]) {
    const needs = needsOf(product);
    const selling = (count.get(product.id) ?? 0) > 0;
    const partner = products.find((row) => row.id !== product.id && row.image && row.links.length);
    const why = selling ? needs : [...needs, "sales: it has no orders in 60 days, so it waits as a draft"];
    plan.push({
      key: `delivered:${product.id}`, productName: product.name, ready: selling && !needs.length, needs: why,
      draft: draft(`Autopilot: ${product.name} — After Delivery`, `Customers who received ${product.name}.`, "post_purchase", "repeat", "post_purchase", { kind: "order_delivered", productId: product.id }, [
        wait(1),
        email("Email 1: Thanks + How To Use It", "usage_tips", designer, product, "Get the most from your {{Product}}, {{First Name}}", "A few quick tips"),
        wait(5),
        email("Email 2: How Is It Going?", "review_request", designer, product, "How's your {{Product}}, {{First Name}}?", "We'd love to hear how it's going"),
        ...(partner ? [wait(14), email("Email 3: Goes Well With It", "product_collection", designer, partner, "Goes well with your order: {{Product}}", "Order today, pay on delivery")] : [])
      ], false)
    });
    plan.push({
      key: `cart:${product.id}`, productName: product.name, ready: selling && !needs.length, needs: why,
      draft: draft(`Autopilot: ${product.name} — Cart Reminder`, `People who left the ${product.name} order form without ordering.`, "cart_abandonment", "cart", "conversion", { kind: "cart_abandoned", cartMinutes: 60, productId: product.id }, [
        email("Email 1: You Left Something", "cart_reminder", designer, product, "You left something behind, {{First Name}}", "Your order is one step away"),
        wait(1),
        { id: newId("c"), type: "condition", name: "Did they order?", check: { kind: "placed_order" }, yes: [], no: [
          email("Email 2: Still Interested?", "still_interested", designer, product, "Still interested in {{Product}}?", "It's still available, pay on delivery")
        ] }
      ], true)
    });
  }
  return plan;
}
