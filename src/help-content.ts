// Auto-generated in-app HELP content for Protohub.
// Each page key maps to a short, plain-language help entry shown by the (?) button.
// Keys match the `activePage` values used in src/App.tsx.

export type HelpEntry = {
  title: string;
  intro: string;
  sections: { heading: string; points: string[] }[];
  roleNotes?: Record<string, string>;
};

export const PAGE_HELP: Record<string, HelpEntry> = {
  "Dashboard": {
    title: "Dashboard — Help",
    intro:
      "Your at-a-glance business overview: key numbers, stock health, cart conversion, and revenue modelling. Use it to track daily performance and spot trends.",
    sections: [
      {
        heading: "What you can see here",
        points: [
          "Five key metrics — Total Revenue, Gross Profit, Net Profit, Total Orders, and Fulfillment Rate — each showing the current period next to the previous one.",
          "Smart stock health alerts: states at risk of running out, based on the last 7 days of sales. Scan for new alerts or jump straight to Inventory to fix them.",
          "Abandoned cart tracker: how many carts you have captured, contacted, and converted, plus how many still need attention.",
          "Revenue Opportunity Simulator: drag the conversion-rate slider to see what happens to profit if you deliver more orders or lift conversion.",
          "Dashboard Math Rules: the exact formulas behind Revenue, COGS, Logistics, Profit, and Fulfillment so you always know what each number means.",
        ],
      },
      {
        heading: "How to filter and customise",
        points: [
          "Period buttons: choose This Week, Last Week, This Month, Last Month, or pick a custom date range.",
          "Currency switcher: view all amounts in NGN, USD, or GBP.",
          "Product filter: zero in on specific products to see how they contribute to revenue and profit.",
          "Export Report: download all dashboard data as a spreadsheet to analyse or share.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Total Revenue counts delivered orders only — not orders that were merely placed.",
          "Total Orders and Fulfillment Rate count orders created in the period. Fulfillment Rate here is throughput: delivered this period divided by placed this period.",
          "Net Profit subtracts operating expenses; if you have not logged any, it falls back to zero or an estimate.",
          "Smart stock health runs on the last 7 days of real sales velocity, so it predicts run-outs rather than just checking a fixed threshold.",
          "This Week always runs Sunday through Saturday.",
        ],
      },
    ],
    roleNotes: {
      Viewer:
        "You can see all metrics and trends, but you cannot export reports or change settings.",
    },
  },

  "Orders": {
    title: "Orders — Help",
    intro:
      "Track and manage all active orders from customers. Assign each order to a delivery agent, follow up on pending ones, and watch delivery progress.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Search orders by number, customer name, or phone number.",
          "Filter by status, location, product, or source (WhatsApp, form, and so on).",
          "Assign orders to delivery agents — the system suggests agents in the customer's state and shows their stock levels.",
          "View details, edit the customer or items, bulk-update statuses, or delete orders.",
          "Export filtered orders as CSV and model the revenue impact of a higher delivery rate.",
        ],
      },
      {
        heading: "Assigning to an agent",
        points: [
          "Open an order's details, then tap Assign to Agent.",
          "Orders route to the agent hub in the customer's state, and the hub must be able to fulfil every line (main item plus add-ons). The system shows in-state agents first and colour-codes stock (green = enough, yellow = partial, red = none).",
          "If no in-state agent can fulfil it, turn on Show all states to cross-assign so an agent ships from another state.",
          "If an agent is low on stock, top them up first via Inventory then Distribute Stock.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Periods: pick This Week, Last Week, or a custom date range to view past orders.",
          "The Response column shows how long the customer has been waiting, in hours or days (colour-coded).",
          "Select several orders to bulk-mark them Confirmed, In Process, Dispatched, Delivered, and so on.",
        ],
      },
    ],
    roleNotes: {
      Viewer:
        "You have view-only access here. You can read order details and search, but you cannot edit, assign to agents, change status, or delete.",
    },
  },

  "Follow-up Queue": {
    title: "Follow-up Queue — Help",
    intro:
      "See every order waiting on a callback, a scheduled delivery, or a customer action. This is where you track promised follow-ups and keep deals moving.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "View all orders that need a follow-up call or action — postponed orders, scheduled deliveries, and note reminders.",
          "See which callbacks are overdue (Due Now) and which are due soon, so you know what to handle first.",
          "Track buyers who asked for another try (Recoverable) and those who are hard to reach (Unreachable) to decide the next step.",
          "Open an order to log a contact attempt, set or reschedule a follow-up, or mark it postponed or ready for delivery.",
          "Filter by status, product, source, or location, or search by order ID, customer name, or phone number.",
        ],
      },
      {
        heading: "How orders show up here",
        points: [
          "Orders with a Postponed status.",
          "Orders with a scheduled delivery date that have not been delivered yet.",
          "Orders with a note that includes a follow-up reminder (for example, \"call tomorrow at 2pm\").",
          "Orders are ranked by urgency: overdue callbacks first, then due soon, then by when they were created.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Delivered, cancelled, and failed orders are not here — find those in Closed Orders.",
          "Contact attempts and follow-up tasks show the history of every call or action, along with the outcome.",
          "Recovery buckets (like \"call tomorrow\" or \"waiting on salary\") let you batch similar buyers into one sweep of calls.",
        ],
      },
    ],
    roleNotes: {
      Viewer:
        "You can view and search the queue, but you cannot log contact attempts, schedule follow-ups, or change order status. Ask a Manager or Admin to make those updates.",
    },
  },

  "Closed Orders": {
    title: "Closed Orders — Help",
    intro:
      "Review every order that has reached a final state — delivered, cancelled, or failed. Open orders are kept out, so you can focus on outcomes without pipeline noise.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Filter by status (Delivered, Cancelled, Failed) and search by order ID, customer name, or phone number.",
          "Filter by product, source (web form, WhatsApp, API), location, or schedule marker to narrow the view.",
          "See the outcome breakdown in the insight card: how many delivered, cancelled, or failed.",
          "Export all visible orders as CSV for reporting or analysis.",
          "Open any order to see what went wrong or confirm it completed cleanly.",
        ],
      },
      {
        heading: "How dates and periods work",
        points: [
          "Pick a period (This Week, Last Week, This Month, Last Month, or Custom) to see closed orders from that timeframe.",
          "This Week runs Sunday through Saturday.",
          "Switch the currency to NGN, USD, or GBP — amounts convert at the current rates.",
          "The metric cards update as you filter, so the counts always match your selection.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Orders here need no further action — they have finished their lifecycle.",
          "The Closed Orders by Product card shows which products drive your final outcomes.",
          "If your role allows it, you can create a new order directly from this page.",
        ],
      },
    ],
    roleNotes: {
      Viewer:
        "You have view-only access here. You can search, filter, and export, but you cannot create orders.",
    },
  },

  "Abandoned Carts": {
    title: "Abandoned Carts — Help",
    intro:
      "Recover incomplete orders: track carts captured from your order form, assign them to your team for follow-up, and watch how many convert.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "View all captured carts with customer details, products, and value.",
          "Assign carts to sales reps and track their follow-up progress.",
          "Set a cart status (Contacted, No response, Not interested) or convert it into a real order.",
          "Filter by period, product, or customer to focus your recovery effort.",
          "See team recovery outcomes — how many assigned carts converted, and how those orders delivered.",
        ],
      },
      {
        heading: "Recovery tracking",
        points: [
          "The team recovery leaderboard shows who converted the most carts.",
          "Conversion rate shows the share of captured carts that became real orders.",
          "Delivery outcomes show how many recovered orders delivered, failed, or are still pending.",
          "Recovered revenue sums the value of carts that converted and then delivered.",
        ],
      },
      {
        heading: "Form insights (Owner and Admin only)",
        points: [
          "Live Form Pulse shows real-time traffic to your order form — views, clicks, submit attempts, and conversions.",
          "Journey Funnel reveals where customers drop off (for example, after adding extra items).",
          "Top Submit Blocks identifies what stops customers from finishing checkout.",
          "Additional Item Interest shows which add-ons get the most engagement.",
        ],
      },
    ],
    roleNotes: {
      Owner:
        "You see full team recovery outcomes and can use Live Form Pulse to diagnose form traffic issues.",
      Admin:
        "You see full team recovery outcomes and can use Live Form Pulse to diagnose form traffic issues.",
      Manager:
        "You can view carts, assign them to reps, and track team conversion — but not the form health metrics.",
    },
  },

  "Scheduled Deliveries": {
    title: "Scheduled Deliveries — Help",
    intro:
      "Track orders your sales reps have promised to deliver on a specific date. See who delivered on time, who was late, and which deliveries still need attention.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "View all orders that have a promised delivery date (defaults to today).",
          "Check delivery performance: how many promises were kept, how many were late, and how many are still open.",
          "Find overdue deliveries, unassigned orders, and cancelled or failed orders that need follow-up.",
          "Jump to any date or browse by week; filter by product if needed.",
          "Call or WhatsApp a customer, or open the full order details.",
        ],
      },
      {
        heading: "Key numbers to watch",
        points: [
          "Delivery Rate: the share of promised orders actually delivered on the target date.",
          "On-time Rate: orders delivered on or before the promised date.",
          "Late Rate: orders delivered after the promise — still counted as delivered, just outside the window.",
          "Needs Action: overdue (past the promise date and not delivered), unassigned, or failed orders that need ops to step in.",
        ],
      },
      {
        heading: "How to read the table",
        points: [
          "Scheduled shows the promised date; a red Overdue label means it has passed without delivery.",
          "Status shows the current state (for example, Pending, Delivered, Failed, Cancelled).",
          "Rep/Agent lists the sales rep who took the order and the delivery agent assigned to fulfil it.",
          "Delivery fee and location let you check the logistics before confirming the promise.",
        ],
      },
    ],
    roleNotes: {
      Manager:
        "You can see scheduled orders across your operations, but you cannot edit or assign deliveries. Use this to track promise performance and spot overdue or problem schedules.",
      Viewer:
        "This page is not available to you — Scheduled Deliveries is for management and logistics staff.",
    },
  },

  "Deliveries": {
    title: "Deliveries — Help",
    intro:
      "See every order delivered in a chosen period, with revenue and fulfillment performance. Orders are grouped by the date they actually reached the customer.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "View all delivered orders, sorted by delivery date.",
          "See the key numbers: total delivered, revenue, average fulfillment days, and on-time versus late counts.",
          "Search by customer or order number.",
          "Filter by date range, product, or delivery agent.",
          "Export all deliveries as CSV.",
        ],
      },
      {
        heading: "How to read the table",
        points: [
          "Schedule Result shows whether the delivery was On-time (or Early), Late, or had no promised date (Unscheduled).",
          "Fulfillment is the number of days from order placed to actual delivery.",
          "Revenue is the order total, and only delivered orders count toward it.",
          "The Agent column shows who made the delivery.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "This Week runs Sunday through Saturday.",
          "Custom date ranges let you pick any start and end date.",
          "Your currency choice (NGN, USD, or GBP) applies to all money values.",
        ],
      },
    ],
    roleNotes: {
      Manager:
        "You can see all deliveries for your team, but you cannot edit order data from this page.",
    },
  },

  "Inventory": {
    title: "Inventory — Help",
    intro:
      "Track and manage warehouse stock and per-state agent inventory in one place. Watch total stock value, units on hand, and how stock is spread across your hubs.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "See total inventory value and unit count across the warehouse plus all agent hubs.",
          "Add new products and manage pricing, COGS, and stock levels.",
          "Build reusable combo bundles for quick add-ons and after-submit offers.",
          "View stock per agent and hub, and a per-state breakdown, in real time.",
          "Run stock-count sessions to reconcile physical counts against system records.",
        ],
      },
      {
        heading: "Key sections",
        points: [
          "Product Library: add items, set price and cost, and view warehouse balances.",
          "Agent Hubs: see how much stock each agent holds by state and location.",
          "Combo Library: build multi-item bundles to reuse as quick add-ons.",
          "Stock History: audit every addition, correction, and movement.",
          "Stock Count: physical counts where the agent and admin both confirm, then you verify or flag any difference.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Orders always route to the hub in the customer's state, and every item must be fulfillable there.",
          "You can switch the currency (NGN, USD, GBP) at the top — this only changes the display.",
          "Stock Count needs both sides to match before you can mark it Verified.",
        ],
      },
    ],
    roleNotes: {
      "Inventory Manager":
        "This is your main workspace — you manage all stock levels, agent distribution, and stock reconciliation.",
    },
  },

  "Sales Reps": {
    title: "Sales Reps — Help",
    intro:
      "Track your sales team at a glance with a leaderboard and per-rep stats. Add reps, watch their conversion rates, and manage their status.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Add new sales reps to your team.",
          "View a performance leaderboard ranked by delivered revenue (top 5).",
          "Search, filter, and manage every rep in one table.",
          "Activate or deactivate a rep to control whether they get round-robin assignments.",
          "Click any rep to view details or edit their profile.",
        ],
      },
      {
        heading: "How to read the metrics",
        points: [
          "Total Reps counts everyone with a sales rep role; Active Reps counts only those eligible for round-robin.",
          "Total Orders counts orders placed and assigned to reps during your selected period.",
          "Avg Conversion is the team's average delivered-to-assigned ratio (delivered divided by assigned).",
          "Each rep's Revenue comes from delivered orders only, within your chosen period.",
          "A higher conversion percentage means more of that rep's assigned orders are getting completed.",
        ],
      },
      {
        heading: "Quick tips",
        points: [
          "Pick a period (Today, This Week, This Month, and so on) to compare performance across ranges.",
          "Filter by product to isolate how reps perform on specific items.",
          "The leaderboard appears after your first delivery and ranks by revenue earned in the period.",
        ],
      },
    ],
  },

  "Sales Teams": {
    title: "Sales Teams — Help",
    intro:
      "Create selling groups, assign team leads, and scope products to the teams that sell them. Watch how each lead manages follow-ups, delivery, and pipeline health.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Create teams and assign a team lead to each one.",
          "Add sales reps to teams and scope products (or leave all products open to a team).",
          "See each lead's performance score — how well they manage delivery, follow-ups, pipeline health, and team consistency.",
          "Check which buyers need action now (overdue follow-ups), which are due soon, how many orders are open, and which deals are at risk.",
        ],
      },
      {
        heading: "Key numbers on this page",
        points: [
          "Delivery Rate: how many orders the team delivered in the period.",
          "Manager Score: a weighted 0–100 score for how well the lead is managing. Higher is better.",
          "Avg Manager Score: the average score across all team leads.",
          "Handled Today: how many follow-ups or buyer actions the lead took today.",
          "Need Action Now: how many buyers are overdue (past their follow-up promise time).",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Each team can sell all products or just a scoped few.",
          "The rep assignment table shows which reps belong to which team, with their delivery rates.",
          "Team lead status shows when they last opened the app and last took action.",
          "Buyer health (Watch, At Risk, Not Serious) shifts based on how well follow-ups are handled.",
        ],
      },
    ],
  },

  "Weekend Stock Summary": {
    title: "Weekend Stock Summary — Help",
    intro:
      "See your delivery agents' weekly stock at a glance — opening, received, delivered, and closing — built for quick summaries you can copy or send to agents without touching inventory controls.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "See each agent's stock position for any week: opening balance, units received, units delivered, adjustments, and closing balance.",
          "Filter by agent, state, or product, or search by name or hub.",
          "Copy a summary to the clipboard or send it straight to an agent on WhatsApp.",
          "Export all visible rows as CSV for reporting.",
          "Move to the previous or next week, or jump to any week with the date picker.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "This is a summary view — you cannot edit stock here. To adjust inventory, use the Inventory or Stock History pages.",
          "Opening balances come from the first weekly snapshot; closing figures track real delivered orders and inventory changes.",
          "The week always runs Sunday to Saturday, and any date you pick snaps back to that week's Sunday.",
          "The This Week button always jumps to the current week.",
          "Tap Refresh if new deliveries or stock moves have landed but are not showing yet.",
        ],
      },
      {
        heading: "Column breakdown",
        points: [
          "Opening — stock at the start of the week. Received — units added during the week.",
          "Delivered — units used to fulfil customer orders.",
          "Adjustments — the net of returned, transferred, restored, and written-off units (click to drill in).",
          "Closing — stock the agent has now.",
        ],
      },
    ],
    roleNotes: {
      "Sales Rep":
        "You see the Weekend Stock Summary for your own stock and hubs only.",
    },
  },

  "Agents": {
    title: "Agents — Help",
    intro:
      "Track your delivery partners' performance, stock, and earnings across all state hubs. Spot who is delivering well, catch problems early, and manage stock at the hub level.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "View all delivery agents and their status (active or inactive).",
          "See top performers by revenue, deliveries, and success rate — and flag agents who need support.",
          "Check how much stock each agent holds per state hub and which products they have on hand.",
          "Click an agent's name for full detail: orders, revenue, delivery rate, stock value, and shrinkage (defective plus missing).",
          "Add an agent, assign stock to their hubs, reconcile inventory, or edit and delete as needed.",
        ],
      },
      {
        heading: "Key metrics explained",
        points: [
          "Delivery Rate = orders delivered divided by total orders assigned to the agent (in the selected period).",
          "Stock Value = the cost of inventory they currently hold across all their state hubs.",
          "Shrinkage = the value of stock marked defective or missing — watch for trends.",
          "Revenue = cash from delivered orders only.",
          "Active on Duty = agents with their status toggled on right now.",
        ],
      },
      {
        heading: "Tips",
        points: [
          "Use period filters (This Week, Last Month, and so on) and date ranges to compare performance over time.",
          "Filter by zone or status to focus on a region or on active versus inactive agents.",
          "Click Assign Stock to distribute new inventory to an agent's hubs.",
          "Click Reconcile to record stock movements (damaged, lost, or updated quantities) for the audit trail.",
          "Export the list as CSV to share with management or load into a spreadsheet.",
        ],
      },
    ],
    roleNotes: {
      Owner:
        "You have full access: add, edit, and delete agents, and manage all their assignments and inventory.",
      Admin:
        "You have full access: add, edit, and delete agents, and manage all their assignments and inventory.",
      "Inventory Manager":
        "You can view all agents and their stock, assign inventory to hubs, and reconcile stock movements, but you cannot add, edit, or delete agent records.",
    },
  },

  "Waybill": {
    title: "Waybill — Help",
    intro:
      "Track stock moving between your warehouse and state hubs, or between agents. Record manual transfers and watch delivery status with waybill fees.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Create waybills to move stock from warehouse to hub or between agents.",
          "View all active, received, and cancelled transfers with quantities and routes.",
          "Mark a shipment as received when it arrives at its destination.",
          "See automatic waybills created from customer deliveries alongside your manual transfers.",
          "Track waybill fees and filter by date, product, status, or flow type.",
        ],
      },
      {
        heading: "Key info",
        points: [
          "Manual transfers are stock you move between locations (warehouse to hub, or hub to hub).",
          "Customer deliveries are records created automatically when orders are delivered — you do not create these.",
          "In Transit means the waybill has been sent and is waiting for Mark Received at the destination.",
          "Summary cards show counts of pending transfers, completed receipts, and total fees charged.",
        ],
      },
      {
        heading: "Actions on a waybill",
        points: [
          "Mark Received: confirm the stock arrived (changes status from In Transit to Received).",
          "Edit: change the details of an In Transit waybill before it is received.",
          "Cancel: remove an In Transit waybill if the shipment was called off.",
          "Print: generate a waybill document for your records or your logistics partner.",
        ],
      },
    ],
  },

  "Payroll": {
    title: "Payroll — Help",
    intro:
      "Set pay rates for your team and run monthly payroll. Configure how each person is paid, preview earnings for any month, apply bonuses and penalties, and keep a payroll history.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Set pay rates: choose a structure (fixed salary, per-order commission, hybrid, or performance tiers) for each team member.",
          "Preview payroll: pick any month and see the full breakdown — fixed salary, commission, bonuses, and deductions — before finalising.",
          "Apply bonuses: set a monthly top-performer bonus (for the rep with the most delivered orders) and let the system work it out.",
          "Apply penalties: deduct amounts for issues like fake upgrades or missed recoveries.",
          "Save and manage runs: create drafts with notes, approve them, mark as paid, and view the full history.",
        ],
      },
      {
        heading: "Payroll breakdown",
        points: [
          "Fixed Salary: the flat monthly amount, if you use that structure.",
          "Commission: earned per delivered order, based on the person's rate.",
          "Auto-Bonus: added automatically when the person qualifies (for example, top performer for the month).",
          "Deductions: penalties that apply to this month only.",
          "Total: all of the above combined.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "You can only preview and run payroll for past months — future months are locked.",
          "If a payroll already exists for a month (Draft, Approved, or Paid), you cannot start a new one, but you can review and approve the existing run.",
          "Penalties are matched to the exact payroll month you are previewing.",
          "If top performers tie on delivered orders, the bonus splits equally between them.",
        ],
      },
    ],
  },

  "Customers": {
    title: "Customers — Help",
    intro:
      "Your full customer directory and relationship tracker. See every customer's details, order history, and reliability, and flag anyone who needs follow-up.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Search and filter customers by name, email, phone, source, state, or products ordered.",
          "See each customer's contact details, latest order, total orders, delivery success rate (Reliability %), and lifetime spend.",
          "Flag a customer with a reason — flagged customers show on a red background; unflag once it is resolved.",
          "View all orders for a customer, export the full list as CSV, and filter by period or currency (NGN, USD, GBP).",
        ],
      },
      {
        heading: "Key metrics at a glance",
        points: [
          "Reliability % = successful orders divided by total orders, times 100 — green at 70%+, yellow 40–69%, red below 40%.",
          "Active Customers = customers with at least one delivered order in your selected period.",
          "Returning Rate = the share of customers who placed 2 or more orders (your loyal repeat buyers).",
          "Avg. Lifetime Value = total delivered spend divided by number of customers (shows your highest-value segment).",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Flagging does not block orders — it is just a note to your team to follow up or take care.",
          "Cancelled or undelivered orders lower a customer's Reliability %, which affects their rating.",
        ],
      },
    ],
    roleNotes: {
      Viewer:
        "You can browse, search, and filter customers, but you cannot flag them, view their orders, or export data.",
    },
  },

  "Expenses": {
    title: "Expenses — Help",
    intro:
      "Track all operational costs — ad spend, delivery, waybills, and general overhead. See which expenses hit profit hardest and which products cost the most to support.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Add, view, and manage all operational expenses (ad spend, delivery, clearing/waybill, airtime/data, and other costs).",
          "Filter by expense type and search descriptions to find a specific cost.",
          "View the Profit Impact Report, which shows how revenue flows down to net profit after every expense.",
          "Export expense records as CSV for accounting or reporting.",
        ],
      },
      {
        heading: "Key numbers you will see",
        points: [
          "Total Expenses — all costs this period, plus the record count.",
          "Product-Linked Expenses — costs tied to specific products (as a share of the total).",
          "General Expenses — operations and overhead costs.",
          "Daily Burn Rate — the average daily spend across the period.",
          "Profit Impact Report — Gross Revenue minus COGS minus Logistics minus Operating Expenses equals Net Profit.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Filter by period (This Week, This Month, This Quarter, This Year, or a custom range) and switch currencies.",
          "Top 5 Products by Expense shows which products drive the most cost.",
          "Monthly Expense Trend shows the last 6 months, with the current month highlighted.",
          "Expenses can be pulled in automatically from Waybill records (shown as \"from Waybill\" in the list).",
        ],
      },
    ],
    roleNotes: {
      Owner: "You have full access to add, view, and manage all expenses.",
      Admin: "You have full access to add, view, and manage all expenses.",
    },
  },

  "Finance & Accounting": {
    title: "Finance & Accounting — Help",
    intro:
      "Full financial reporting and cash management for Protohub. See revenue, profit, and expenses, and track the cash your delivery partners still owe.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "View the Financial Overview: total revenue, gross profit, net profit, and expenses for any period.",
          "Track Weekly Accounting: Sunday-to-Saturday cohort reporting with daily order and delivery breakdowns.",
          "Monitor Remittance: what cash partners owe, what has been received, and what is still outstanding.",
          "Review Profit & Loss: revenue minus costs and operating expenses, with period-to-period comparisons.",
          "Analyse product profitability and per-rep payouts, and track sales rep and agent cost breakdowns.",
        ],
      },
      {
        heading: "Key concepts",
        points: [
          "Revenue = money from delivered orders only (pending and failed orders do not count).",
          "Net Profit = revenue minus COGS (product costs) minus delivery fees minus operating expenses.",
          "Remittance = cash agents collected on delivery and owe back to you, shown as an outstanding balance.",
          "Gross Margin = (revenue minus COGS) divided by revenue; Net Margin = net profit divided by revenue.",
          "Cash Position reconciles recognised revenue against the cash actually received from partners.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Use the period pills (Today, This Week, This Month, This Year) or a custom range to filter every report.",
          "Filter by product to view a single product's financials, or merge several products together.",
          "Export PDF for Profit & Loss, or CSV for Agent Costs, using the Export button at the top.",
          "Remittance outstanding shows what logistics partners still owe on delivered-period receivables.",
          "Historic cash entries use receipt dates (when the cash was logged), not order creation dates.",
        ],
      },
    ],
  },

  "Ad Tracking": {
    title: "Ad Tracking — Help",
    intro:
      "See which ad campaigns and creatives are driving sales by tracking orders from tagged links. Add UTM tags (utm_campaign, utm_content, utm_source) to your links so every order gets the right credit.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Campaign Orders: see tracked orders grouped by campaign (utm_campaign) and creative (utm_content), plus which channels deliver versus stall.",
          "Abandoned Carts: track carts abandoned from your tagged links, recovery by channel, and which campaigns and creatives drive abandonment.",
          "Daily Ad Spend: log weekly spend per product per day and watch ROAS (revenue divided by spend) update live, so you spot winners and losers fast.",
          "Add labels: give campaigns and creatives friendly names so the whole team refers to them the same way.",
        ],
      },
      {
        heading: "Key metrics",
        points: [
          "Tracked Orders = orders that carry UTM tags; Attributed Revenue = delivered tracked orders only.",
          "Delivery Rate = of this campaign or channel, how many ordered items actually got delivered.",
          "ROAS = return on ad spend — 2x means you earned 2 naira for every 1 naira spent (profitable); below 1x means you lost money.",
          "Recovery Rate = of abandoned carts from this channel, how many later converted into real orders.",
        ],
      },
      {
        heading: "Getting started",
        points: [
          "Tag your ad links with UTM parameters, for example: ?utm_campaign=promo_jan&utm_content=banner_v2&utm_source=instagram",
          "Use those links in WhatsApp, email, or ads — Protohub reads the UTM values automatically when orders come in.",
          "Log spend in the Daily Ad Spend tab each day so ROAS stays up to date.",
          "Open the guide (button on Campaign Orders) to learn the exact UTM naming rules.",
        ],
      },
    ],
  },

  "User Management": {
    title: "User Management — Help",
    intro:
      "Create and manage staff accounts, assign roles and permissions, and control who can access what in Protohub. Owner only.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Add new staff and set their role (Owner, Admin, Manager, Sales Rep, Inventory Manager, Viewer).",
          "View all users and their activity — how many are active, new this month, and online now.",
          "Search and filter users by name, email, role, or status (enabled or disabled).",
          "See each person's permissions and enable or disable their account.",
          "Edit user details, reset passwords, or remove staff.",
        ],
      },
      {
        heading: "Common tasks",
        points: [
          "Click Add User to create a new staff account.",
          "Click Permissions to see what each role can do (Owner has full access).",
          "Use the toggle to enable or disable an account without deleting it.",
          "Click View as to sign in as another user and see exactly what they see.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Each role grants default permissions automatically — you can customise them if needed.",
          "Disabled guest or test accounts also appear here.",
          "The Online Now card shows staff active in the last 5 minutes.",
          "The User Growth and Role Distribution charts help you track team size and structure.",
        ],
      },
    ],
  },

  "Round-Robin": {
    title: "Round-Robin — Help",
    intro:
      "Decide who gets the next incoming lead or order. This page controls the automatic assignment sequence for your sales team.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "See who is next in line for the next incoming order.",
          "Reorder the sequence with Advance (move #1 to the end), Skip Rep (move #1 two places down), or Reset (sort alphabetically and start over).",
          "Temporarily exclude a rep from new orders, or re-enable them when ready.",
          "View each rep's open order count and delivered count this week.",
        ],
      },
      {
        heading: "How round-robin works",
        points: [
          "Incoming orders are assigned automatically to the rep at position #1.",
          "After an assignment, that rep moves to the end of the active sequence.",
          "Excluded reps are skipped entirely — they stay under Temporarily Excluded and get no orders until you re-enable them.",
          "The sequence applies to new incoming orders only, not to manual reassignments.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Use Skip Rep to give the current #1 a breather without losing their place in line.",
          "Use Advance Sequence to rotate the queue manually (for example, when someone is unavailable).",
          "Use Reset Sequence to start fresh — reps go back to alphabetical order at position 1.",
          "Search by name to find a rep in the active or excluded list.",
        ],
      },
    ],
    roleNotes: {
      Manager:
        "You can manage the round-robin sequence for your team. Admin can also update individual rep settings from here.",
    },
  },

  "Embed Form": {
    title: "Embed Form — Help",
    intro:
      "Set up and customise an order form you can embed on any website. Customers fill it in to place orders directly, and you control which fields show, which states are available, and how orders are assigned.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Customise form fields (email, WhatsApp, address, city, delivery date) and choose which are required.",
          "Switch between the classic and guided checkout layouts.",
          "Set which Nigerian states customers can choose.",
          "Add a marketing message above the package picker.",
          "Preview the live form in a new tab before publishing.",
        ],
      },
      {
        heading: "Order assignment modes",
        points: [
          "Auto-assign: orders go straight to the next sales rep in your round-robin sequence.",
          "Manual review: orders arrive unassigned so you can pick the right sales rep first.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "Phone number is always required and cannot be made optional.",
          "Per-product changes (states, marketing message) save automatically; form-wide settings need a manual save.",
          "Extra offers are managed in Inventory, under each package's Promote This Package section.",
        ],
      },
    ],
  },

  "Notifications": {
    title: "Notifications — Help",
    intro:
      "Your notification centre tracks order events, stock alerts, and other operational updates. Filter by period and product, and manage which ones you have reviewed.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "View all system notifications: order updates (new, confirmed, delivered, cancelled, assigned, follow-up reminders), low stock alerts, and overdue remittance notices.",
          "Filter by All or Unread using the toggle at the top.",
          "Search a custom date range or quick period (This Week, Last Month, and so on) and filter by product.",
          "Expand any notification to see full details, type, order ID, timestamp, and product info.",
          "Mark notifications read one at a time or all at once, then delete all read ones to clear your inbox.",
        ],
      },
      {
        heading: "How notifications work",
        points: [
          "They are created automatically when orders or inventory events happen — you do not create them yourself.",
          "Unread notifications show a blue dot; click one to mark it read and jump to that order or page.",
          "Read notifications stay in your history until you delete them — use Delete read to tidy up.",
        ],
      },
      {
        heading: "Tips",
        points: [
          "Use the period filter to focus on recent alerts (for example, This Week or Today) or search a custom range.",
          "Expand a notification to read the full message and exact timestamp before you act.",
          "Notifications are listed newest first, with up to 25 per page.",
        ],
      },
    ],
  },

  "Settings": {
    title: "Settings — Help",
    intro:
      "Manage your account and preferences for notifications, email, SMS, and workspace setup. What you see depends on your role.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Turn push notifications on or off on this device, for orders, low stock, waybills, and other alerts.",
          "Set up and test email delivery (Owner only) — configure Resend or Mailjet, create templates, and watch activity.",
          "Check your SMS credit balance and configure SMS delivery (Owner sets it up; Admin can view the balance).",
          "Adjust quiet hours and retry rules for customer SMS messages.",
          "Install the app on your home screen for the most reliable push notifications on mobile.",
        ],
      },
      {
        heading: "Push Notifications tab",
        points: [
          "See your current permission status and registered devices.",
          "Turn notifications on or off with one click.",
          "Force a re-subscribe if your registration goes stale (handy when switching devices or browsers).",
          "Send a test notification to confirm everything works.",
          "Update your service worker if notifications stop arriving.",
        ],
      },
      {
        heading: "Email & SMS tabs",
        points: [
          "Email (Owner only): choose a provider, set up the sender identity, enable flows like order confirmations, and edit templates.",
          "SMS (Owner sets up; Admin views balance): set the API key, sender name, quiet hours, and retry rules for customer SMS.",
          "Both tabs show activity logs so you can see what went out and catch any failures.",
        ],
      },
    ],
    roleNotes: {
      Owner:
        "You can configure all three areas: Workspace, Email Delivery, and SMS Delivery. Email and SMS setup are Owner-only; other roles see reduced or read-only views.",
      Admin:
        "You see Workspace and can check the SMS credit balance, but Email Delivery and full SMS configuration are Owner-only.",
      Manager: "You have access to Workspace settings (push notifications) only.",
      "Sales Rep": "You have access to Workspace settings (push notifications) only.",
      "Inventory Manager":
        "You have access to Workspace settings (push notifications) only.",
      Viewer: "You have access to Workspace settings (push notifications) only.",
    },
  },

  "Call Rep Console": {
    title: "Call Rep Console — Help",
    intro:
      "Make outbound calls to customers to confirm orders, schedule deliveries, and follow up. Work the call queue one customer at a time, confirm or reschedule, and log each outcome.",
    sections: [
      {
        heading: "What you can do here",
        points: [
          "Work the incoming call queue one customer at a time — each card shows the order, customer name, phone, and product details.",
          "Call (tap Phone) or message (WhatsApp) the customer, or tap Details for the full order.",
          "Reschedule or set a new delivery date if the customer asks.",
          "Mark the outcome: Confirmed, Postponed, Not Picking, or Cancelled.",
          "Add a short note about the call if needed.",
        ],
      },
      {
        heading: "How the queue works",
        points: [
          "The queue lists new orders waiting for a confirmation call, in order of arrival.",
          "Search by order number, customer name, or phone to find a specific call.",
          "Skip moves to the next customer; Refresh starts from the beginning.",
          "Once you confirm, postpone, fail, or cancel an order, it leaves the queue.",
        ],
      },
      {
        heading: "Good to know",
        points: [
          "This is a core part of the Sales Rep workspace — stay here to work through incoming orders.",
          "Delivery scheduling is tied to the customer's state hub; the system checks stock there before you schedule.",
          "Your outcomes directly affect order status and delivery timelines.",
        ],
      },
    ],
  },

  "Sales Rep Workspace": {
    title: "Sales Rep Workspace — Help",
    intro:
      "Your hub for managing orders, customers, and commission. Everything here is personal to you — the orders assigned to you, the customers you work with, and the bonus you earn this week.",
    sections: [
      {
        heading: "Your workspace tabs",
        points: [
          "Dashboard: your order summary, bonus earned so far, the next unlock, and the top actions that boost commission fastest.",
          "Products: browse your catalogue by name, price, or stock, with live availability at agent hubs in your states.",
          "Orders: view all assigned orders, create new ones, log follow-ups, and check delivery status.",
          "Scheduled Deliveries & Abandoned Carts: manage promised dates and recover incomplete customer carts.",
          "Customers & Leaderboard: see customer spend and order history, and track how you rank against other reps by revenue, deliveries, and conversion.",
        ],
      },
      {
        heading: "Key metrics on your dashboard",
        points: [
          "Est. Earnings: your commission earned this week, based on delivered orders.",
          "Delivery Rate: your fulfillment percentage, which can gate bonus unlocks when set as a requirement.",
          "Conversion %: orders confirmed and delivered divided by total orders assigned. Higher is better.",
          "Pending and Confirmed counts help you spot bottlenecks in your pipeline.",
        ],
      },
      {
        heading: "Pro tips",
        points: [
          "Use Bonus Coach to see which open orders move your commission fastest this week.",
          "Hot stock signals flag products customers ask for when agent stock is tight — useful data for your inventory requests.",
          "Owner and admin can use View as [Your Name] to coach you; they see exactly what you see here.",
        ],
      },
    ],
  },
};

export const DEFAULT_HELP: HelpEntry = {
  title: "Help",
  intro:
    "This page does not have its own help yet. Here are a few general pointers that apply across Protohub.",
  sections: [
    {
      heading: "Getting around",
      points: [
        "Most pages have a period filter (This Week, Last Week, This Month, and a custom date range). This Week always runs Sunday through Saturday.",
        "You can switch the currency display (NGN, USD, GBP) where money is shown — this only changes the display, not the underlying data.",
        "Use the search and filter controls at the top of a page to narrow what you see.",
      ],
    },
    {
      heading: "Good to know",
      points: [
        "Revenue counts delivered orders only. Net Profit is revenue minus product cost (COGS), delivery, ad spend, and other expenses.",
        "Orders route to the delivery agent hub in the customer's state, and that hub must be able to fulfil every line on the order.",
        "What you can do depends on your role. If an action is missing, your role may not have access — ask an Owner or Admin.",
      ],
    },
  ],
};
