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

test("bonusWeekFor: from 25 Oct, delivered by the Tuesday after = its own week; before that, the delivery week", async () => {
  const { bonusWeekFor } = await import("./late-deliveries.js");
  // Placed Fri 30 Oct, delivered Mon 2 Nov / Tue 3 Nov -> week of 25 Oct.
  assert.equal(bonusWeekFor("2026-10-30", "2026-11-02"), "2026-10-25");
  assert.equal(bonusWeekFor("2026-10-30", "2026-11-03"), "2026-10-25");
  // Delivered Wed 4 Nov (after the report day) -> the week it was delivered.
  assert.equal(bonusWeekFor("2026-10-30", "2026-11-04"), "2026-11-01");
  // Before the rule: placed 24 Oct, delivered 27 Oct -> the delivery week.
  assert.equal(bonusWeekFor("2026-10-24", "2026-10-27"), "2026-10-25");
  // Delivered in its own week -> its own week.
  assert.equal(bonusWeekFor("2026-10-26", "2026-10-28"), "2026-10-25");
});

test("an order the report day should have paid, missed because the report went first, is paid next", () => {
  // Week of 25 Oct sent on Mon 2 Nov; order placed 30 Oct, delivered Tue 3 Nov.
  const reports = [sent("2026-10-25", [delivered("7000", "2026-10-28")], "submitted")];
  const orders = [{ id: "7001", assigned_rep_id: "rep", delivered_date: "2026-11-03", created_at: "2026-10-30T10:00:00Z" }];
  assert.deepEqual(findLateDeliveries(reports, orders), [
    { repId: "rep", orderId: "7001", deliveredDate: "2026-11-03", deliveredWeek: "2026-10-25", payWeek: "2026-11-01" }
  ]);
  // Paid on its report day: nothing late.
  const paidReports = [sent("2026-10-25", [{ id: "7001", date: "2026-10-30", status: "Delivered", deliveredDate: "2026-11-03" }], "submitted")];
  assert.deepEqual(findLateDeliveries(paidReports, orders), []);
});
