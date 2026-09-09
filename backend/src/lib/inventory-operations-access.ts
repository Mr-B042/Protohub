// What an "Inventory Manager & Logistics Operations" user is allowed to see on
// an order.
//
// ⚠️ AN ALLOWLIST, NOT A BLOCKLIST. Anything not named here never leaves the
// server for this role: no amount, no customer name, no phone. That is
// deliberate - the role moves stock, it does not handle money or customers.

/**
 * The call results a rep can actually pick (orderStatusViews in App.tsx).
 *
 * ⚠️ THE FIELD IS PART STATUS, PART FREE TEXT. Reps type into it too, so it
 * holds both "Ready" and "Customer's line isn't connecting, message sent.
 * 04/09: Sent out. 05/09: Not responding...". Stripping the whole field kept
 * the notes private but also took the status word with it, and the status word
 * is the only thing that says a customer is READY. Without it Who Needs Stock
 * counted 0 of 132 open orders as waiting and showed this role an empty page -
 * the one role the page was built for.
 *
 * So the word travels and the typing does not. A value that is not one of these
 * becomes null, which reads exactly like an order nobody has called yet.
 */
const PICKABLE_CALL_OUTCOMES = new Set([
  "Ready", "Rescheduled", "Not Available", "Call Back", "Number Busy",
  "Switched Off", "Not Answering", "Not Ready", "Follow Up",
  "Product Unavailable", "Rejected"
]);

export const safeCallOutcome = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return PICKABLE_CALL_OUTCOMES.has(text) ? text : null;
};

export const inventoryOperationsOrder = (row: any) => ({
  id: row.id,
  product_id: row.product_id,
  product_name: row.product_name,
  package_id: row.package_id,
  package_name: row.package_name,
  quantity: row.quantity,
  status: row.status,
  // The status word only. Never the rep's typing - see above.
  call_outcome: safeCallOutcome(row.call_outcome),
  state: row.state,
  city: row.city,
  agent_id: row.agent_id,
  agent_location_id: row.agent_location_id,
  created_at: row.created_at,
  updated_at: row.updated_at,
  delivered_date: row.delivered_date,
  scheduled_date: row.scheduled_date,
  review_hold: row.review_hold,
  additional_lines: row.additional_lines,
  cross_sell_lines: row.cross_sell_lines,
  free_gift_lines: row.free_gift_lines,
  package_components_snapshot: row.package_components_snapshot
});
