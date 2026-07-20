// Shared TypeScript types for the API layer.
// Keep these in sync with the database schema.

export type UserRole = "Owner" | "Admin" | "Manager" | "Sales Rep" | "Inventory Manager" | "Marketer" | "Viewer" | "Recovery Rep";
export type CurrencyCode = "NGN" | "USD" | "GBP";
export type OrderStatus = "New" | "Confirmed" | "In Process" | "Dispatched" | "Delivered" | "Cancelled" | "Postponed" | "Failed";
export type OrderSource = "TikTok" | "Facebook" | "WhatsApp" | "Website" | "Direct";
export type CallOutcome = string;
export type StockMovementType = "Stock Added" | "Distributed to Agent" | "Order Fulfilled" | "Return" | "Correction" | "Waybill Out" | "Waybill In";
export type WriteOffReason = "Damaged" | "Theft" | "Unreported Sale" | "Return to Warehouse" | "Other";
export type CountStatus = "Pending" | "Agent Submitted" | "Admin Confirmed" | "Verified" | "Discrepancy";

export interface AuthUser {
  id: string;
  orgId: string;
  role: UserRole;
  email: string;
  name: string;
  marketingAttributionTags?: string[];
  // Set by spy middleware when an Owner/Admin sends X-Spy-User-Id header.
  // Routes use this for data filtering so the Owner sees what the rep sees.
  effectiveUserId?: string;
  effectiveUserRole?: UserRole;
}

export interface ApiError {
  error: string;
  code?: string;
}

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
