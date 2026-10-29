import assert from "node:assert/strict";
import test from "node:test";
import { findLateDeliveries } from "./late-deliveries.js";

const sent = (week: string, orders: any[] = [], status = "locked") => ({ rep_id: "rep", week_start: week, status, orders });
const delivered = (id: string, date: string) => ({ id, status: "Delivered", deliveredDate: date });

test("an order marked delivered after its week's report was sent is paid in the next unsent week", () => {
  // Sent 4 Oct without #5022 (it was still Confirmed); 11 Oct sent too; 18 Oct not sent.
  const reports = [
    sent("2026-10-04", [{ id: "5022", status: "Confirmed", deliveredDate: "" }, delivered("5001", "2026-10-06")]),
    sent("2026-10-11", [delivered("5100", "2026-10-12")], "manager_approved")
  ];
  const orders = [
    { id: "5022", assigned_rep_id: "rep", delivered_date: "2026-10-10" },
    { id: "5001", assigned_rep_id: "rep", delivered_date: "2026-10-06" },
    { id: "5100", assigned_rep_id: "rep", delivered_date: "2026-10-12" }
  ];
  assert.deepEqual(findLateDeliveries(reports, orders), [
    { repId: "rep", orderId: "5022", deliveredDate: "2026-10-10", deliveredWeek: "2026-10-04", payWeek: "2026-10-18" }
  ]);
});

test("not offered again once a sent report carries it, and not while its own week is unsent", () => {
  const reports = [
    sent("2026-10-04", [{ id: "5022", status: "Confirmed", deliveredDate: "" }]),
    sent("2026-10-11", [{ id: "5022", status: "Delivered", deliveredDate: "2026-10-10", lateRecorded: { deliveredWeek: "2026-10-04" } }])
  ];
  assert.deepEqual(findLateDeliveries(reports, [{ id: "5022", assigned_rep_id: "rep", delivered_date: "2026-10-10" }]), []);
  // Week of 18 Oct not sent: its own report will take the order normally.
  assert.deepEqual(findLateDeliveries([sent("2026-10-11")], [{ id: "6000", assigned_rep_id: "rep", delivered_date: "2026-10-20" }]), []);
});
