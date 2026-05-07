/**
 * Seed script — populates the agents table with 44 Nigerian logistics partners.
 *
 * Usage:
 *   ORG_ID=<your-org-uuid> npm run db:seed-agents
 *
 * Idempotent: uses upsert with ignoreDuplicates on (org_id, name).
 */
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

const ORG_ID = process.env.ORG_ID;
if (!ORG_ID) {
  console.error("ERROR: ORG_ID env var is required.\n  Usage: ORG_ID=<uuid> npm run db:seed-agents");
  process.exit(1);
}

const agents = [
  { name: "Adewale Logistics",          phone: "08031234501", zone: "Lagos" },
  { name: "Bello Express",              phone: "08031234502", zone: "Kano" },
  { name: "Chinonso Deliveries",        phone: "08031234503", zone: "Anambra" },
  { name: "DanLadi Freight",            phone: "08031234504", zone: "Kaduna" },
  { name: "Emeka Swift",                phone: "08031234505", zone: "Enugu" },
  { name: "Funke Dispatch",             phone: "08031234506", zone: "Oyo" },
  { name: "Garba Movers",               phone: "08031234507", zone: "Borno" },
  { name: "Hassan Couriers",            phone: "08031234508", zone: "Sokoto" },
  { name: "Ikenna Express",             phone: "08031234509", zone: "Imo" },
  { name: "Jide Cargo",                 phone: "08031234510", zone: "Ogun" },
  { name: "Kola Riders",                phone: "08031234511", zone: "Osun" },
  { name: "Lateef Haulage",             phone: "08031234512", zone: "Kwara" },
  { name: "Musa Prime Delivery",        phone: "08031234513", zone: "Niger" },
  { name: "Ngozi QuickShip",            phone: "08031234514", zone: "Abia" },
  { name: "Obinna Transits",            phone: "08031234515", zone: "Delta" },
  { name: "Peter PackRun",              phone: "08031234516", zone: "Plateau" },
  { name: "Quadri Fleet",               phone: "08031234517", zone: "Lagos" },
  { name: "Rasheed Go",                 phone: "08031234518", zone: "Oyo" },
  { name: "Sani Direct",                phone: "08031234519", zone: "Katsina" },
  { name: "Tunde ParcelPro",            phone: "08031234520", zone: "Ekiti" },
  { name: "Uche RouteMax",              phone: "08031234521", zone: "Rivers" },
  { name: "Victor VanLine",             phone: "08031234522", zone: "Edo" },
  { name: "Wasiu SpeedBox",             phone: "08031234523", zone: "Ondo" },
  { name: "Xpress Yakubu",              phone: "08031234524", zone: "Bauchi" },
  { name: "Yusuf YardRun",              phone: "08031234525", zone: "Yobe" },
  { name: "Zainab Zonal Dispatch",      phone: "08031234526", zone: "Zamfara" },
  { name: "Afolabi Ace Movers",         phone: "08031234527", zone: "Lagos" },
  { name: "Blessing Bridge Logistics",  phone: "08031234528", zone: "Cross River" },
  { name: "Chukwuemeka City Express",   phone: "08031234529", zone: "Ebonyi" },
  { name: "Damilola DashLine",          phone: "08031234530", zone: "Ogun" },
  { name: "Ese Eastside Cargo",         phone: "08031234531", zone: "Edo" },
  { name: "Folashade FastTrack",        phone: "08031234532", zone: "Osun" },
  { name: "Godwin GreenRoute",          phone: "08031234533", zone: "Benue" },
  { name: "Hauwa HubFreight",           phone: "08031234534", zone: "Adamawa" },
  { name: "Ibrahim InstaMove",          phone: "08031234535", zone: "Nasarawa" },
  { name: "Jumoke JetPack Logistics",   phone: "08031234536", zone: "Kwara" },
  { name: "Kunle KwikDrop",             phone: "08031234537", zone: "Ondo" },
  { name: "Lukman LinkHaul",            phone: "08031234538", zone: "Kogi" },
  { name: "Mercy Metro Dispatch",       phone: "08031234539", zone: "Akwa Ibom" },
  { name: "Nnamdi NorthStar Delivery",  phone: "08031234540", zone: "Enugu" },
  { name: "Ojo OmniCargo",              phone: "08031234541", zone: "Lagos" },
  { name: "Patricia PrimeLine",         phone: "08031234542", zone: "Rivers" },
  { name: "Rilwan RoadKing",            phone: "08031234543", zone: "Taraba" },
  { name: "Segun StreetDash",           phone: "08031234544", zone: "FCT" },
];

const rows = agents.map((a) => ({
  org_id: ORG_ID,
  name: a.name,
  phone: a.phone,
  zone: a.zone,
  status: "Active",
}));

async function main() {
  console.log(`Seeding ${rows.length} agents for org ${ORG_ID} …`);

  const { data, error } = await supabase
    .from("agents")
    .upsert(rows, { onConflict: "org_id,name", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }

  console.log(`Done. ${data.length} agent(s) inserted (duplicates skipped).`);
}

main();
