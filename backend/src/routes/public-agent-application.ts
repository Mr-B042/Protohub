// Public self-application for Personal Delivery Agents.
//
// An applicant fills in their own details and waits for approval, rather than
// someone in the office re-typing everything from a WhatsApp thread.
//
// ⚠️ This is UNAUTHENTICATED, so every route here assumes the caller is hostile
// until proven otherwise:
//   - the link carries a random token, never the org id
//   - links are revocable, optionally expiring, and can carry a submission cap,
//     because a link forwarded around WhatsApp cannot be un-forwarded
//   - uploads are size- and type-checked and land in the PRIVATE bucket
//   - a submission can only ever create an application awaiting review; there
//     is no path from here to an approved agent
import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";

const router = Router();

const LINKS = "pda_application_links";
const AGENTS = "personal_delivery_agents";
const KYC = "pda_kyc_items";
const GUARANTORS = "pda_guarantors";
const KYC_BUCKET = "pda-kyc";

/** Tight limits: this endpoint is open to the internet. */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many applications from this connection. Try again later." }
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads from this connection. Try again later." }
});
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

/** Resolves a token to a usable link, or explains precisely why it is not. */
async function resolveLink(token: string) {
  if (!token || token.length < 16) return { error: "This application link is not valid." as const };
  const { data } = await supabase.from(LINKS).select("*").eq("token", token).maybeSingle();
  if (!data) return { error: "This application link is not valid." as const };
  if (!data.active) return { error: "This application link has been closed." as const };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { error: "This application link has expired." as const };
  }
  if (data.max_submissions && Number(data.submission_count ?? 0) >= Number(data.max_submissions)) {
    return { error: "This application link is no longer accepting submissions." as const };
  }
  return { link: data };
}

// ── GET /api/public/agent-application/:token ──────────────
// Confirms the link works and returns only what the form needs to render.
// Deliberately exposes nothing about the organisation beyond its name.
router.get("/:token", readLimiter, async (req, res) => {
  const found = await resolveLink(String(req.params.token ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const { data: org } = await supabase.from("organizations").select("name").eq("id", found.link.org_id).maybeSingle();
  res.json({
    ok: true,
    orgName: org?.name ?? "Protohub",
    label: found.link.label ?? null
  });
});

// ── POST /api/public/agent-application/:token/upload ──────
const UPLOAD_MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
  "application/pdf": "pdf", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
};

router.post("/:token/upload", uploadLimiter, async (req, res) => {
  const found = await resolveLink(String(req.params.token ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }

  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(/^data:((?:image|video|application)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) { res.status(400).json({ error: "That file could not be read." }); return; }
  const mime = match[1].toLowerCase();
  const ext = UPLOAD_MIME_EXT[mime];
  if (!ext) { res.status(400).json({ error: "Upload a photo, a PDF or a short video." }); return; }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 25 * 1024 * 1024) { res.status(413).json({ error: "That file is larger than 25MB." }); return; }

  // Namespaced by link so an abusive link's uploads can be found and removed
  // together, without touching anything an employee uploaded.
  const objectName = `${found.link.org_id}/public/${found.link.id}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(KYC_BUCKET)
    .upload(objectName, buffer, { contentType: mime, upsert: false });
  if (error) { res.status(500).json({ error: "Could not save that file. Please try again." }); return; }
  res.status(201).json({ path: objectName });
});

// ── POST /api/public/agent-application/:token ─────────────
const GuarantorSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  relationship: z.string().trim().max(120).optional(),
  guarantorType: z.enum(["Family", "Independent"]).optional(),
  phone: z.string().trim().min(7).max(40),
  whatsappPhone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  address: z.string().trim().max(500).optional(),
  occupation: z.string().trim().max(160).optional(),
  workplace: z.string().trim().max(160).optional(),
  yearsKnown: z.string().trim().max(60).optional(),
  referenceStatement: z.string().trim().max(1000).optional(),
  idDocumentPath: z.string().trim().max(500).optional()
});

const SubmitSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name as written on your ID.").max(160),
  phone: z.string().trim().min(7, "Enter a phone number we can reach you on.").max(40),
  whatsappPhone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  dateOfBirth: z.string().trim().max(20).optional(),
  gender: z.enum(["Male", "Female", "Prefer not to say"]).optional(),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  residentialAddress: z.string().trim().max(500).optional(),
  emergencyContactName: z.string().trim().max(160).optional(),
  emergencyContactPhone: z.string().trim().max(40).optional(),
  idType: z.enum(["NIN", "Driver's Licence", "Voter's Card", "International Passport"]).optional(),
  idNumber: z.string().trim().max(60).optional(),
  idFrontPath: z.string().trim().max(500).optional(),
  idBackPath: z.string().trim().max(500).optional(),
  selfiePath: z.string().trim().max(500).optional(),
  proofOfAddressPath: z.string().trim().max(500).optional(),
  transportMethod: z.enum([
    "Motorcycle", "Car", "Public transport", "Bicycle", "Walking", "Hired dispatch", "Other"
  ]).optional(),
  vehicleModel: z.string().trim().max(120).optional(),
  vehiclePlate: z.string().trim().max(40).optional(),
  serviceAreas: z.array(z.string().trim().max(80)).max(20).optional(),
  bankName: z.string().trim().max(120).optional(),
  bankAccountNumber: z.string().trim().max(40).optional(),
  bankAccountName: z.string().trim().max(160).optional(),
  guarantors: z.array(GuarantorSchema).max(4).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "Please confirm the details are true before submitting." }) })
});

router.post("/:token", submitLimiter, async (req, res) => {
  const found = await resolveLink(String(req.params.token ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }

  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    res.status(400).json({ error: first ?? "Some details are missing." });
    return;
  }
  const d = parsed.data;
  const orgId = found.link.org_id;

  try {
    // A duplicate phone almost always means someone submitted twice, not a
    // second person. Point them at the office rather than creating a twin
    // application for a reviewer to untangle.
    const { data: existing } = await supabase.from(AGENTS)
      .select("id").eq("org_id", orgId).eq("phone", d.phone).maybeSingle();
    if (existing) {
      res.status(409).json({ error: "An application already exists for this phone number. Please contact the office." });
      return;
    }

    const { count } = await supabase.from(AGENTS).select("id", { count: "exact", head: true }).eq("org_id", orgId);
    const agentCode = `PDA-${String((count ?? 0) + 1).padStart(5, "0")}`;

    const { data: agent, error } = await supabase.from(AGENTS).insert({
      org_id: orgId,
      agent_code: agentCode,
      full_name: d.fullName,
      phone: d.phone,
      whatsapp_phone: d.whatsappPhone || null,
      email: d.email || null,
      date_of_birth: d.dateOfBirth || null,
      gender: d.gender || null,
      state: d.state || null,
      city: d.city || null,
      residential_address: d.residentialAddress || null,
      emergency_contact_name: d.emergencyContactName || null,
      emergency_contact_phone: d.emergencyContactPhone || null,
      id_type: d.idType || null,
      id_number: d.idNumber || null,
      transport_method: d.transportMethod || null,
      vehicle_model: d.vehicleModel || null,
      vehicle_plate: d.vehiclePlate || null,
      service_areas: d.serviceAreas ?? [],
      bank_name: d.bankName || null,
      bank_account_number: d.bankAccountNumber || null,
      bank_account_name: d.bankAccountName || null,
      // Submitted, never approved. There is no path from this endpoint to an
      // agent who can hold stock or cash.
      account_status: "KYC Submitted",
      kyc_status: "KYC Submitted",
      trust_level: "Probation",
      availability: "Offline",
      application_link_id: found.link.id,
      submitted_via: "Public link"
    }).select("id").single();
    if (error || !agent) { res.status(500).json({ error: "Could not submit your application. Please try again." }); return; }

    const DEFAULT_ITEMS: Array<{ key: string; label: string; path?: string }> = [
      { key: "personal_information", label: "Personal Information" },
      { key: "government_id", label: "Government-issued ID (front)", path: d.idFrontPath },
      { key: "government_id_back", label: "Government-issued ID (back)", path: d.idBackPath },
      { key: "proof_of_address", label: "Proof of Address", path: d.proofOfAddressPath },
      { key: "selfie_with_id", label: "Selfie holding ID", path: d.selfiePath },
      { key: "live_verification_video", label: "Live Verification Video" },
      { key: "bank_account", label: "Bank Account" },
      { key: "guarantor_one", label: "Guarantor One" },
      { key: "guarantor_two", label: "Guarantor Two" },
      { key: "agent_agreement", label: "Personal Delivery Agent Agreement" },
      { key: "inventory_agreement", label: "Inventory Custody Agreement" },
      { key: "cod_agreement", label: "COD Collection & Remittance Agreement" },
      { key: "loss_damage_form", label: "Loss & Damage Responsibility Form" },
      { key: "confidentiality_agreement", label: "Data & Customer Confidentiality Agreement" },
      { key: "termination_agreement", label: "Termination & Stock Recovery Agreement" }
    ];
    await supabase.from(KYC).insert(DEFAULT_ITEMS.map((item) => ({
      org_id: orgId,
      agent_id: agent.id,
      item_key: item.key,
      label: item.label,
      mandatory: true,
      // What the applicant supplied is SUBMITTED. Nothing self-submitted is
      // ever pre-approved - that is the reviewer's job, and the whole point.
      status: item.path ? "Submitted"
        : ["personal_information", "bank_account"].includes(item.key) && d.bankAccountNumber ? "Submitted"
        : item.key === "personal_information" ? "Submitted"
        : "Pending",
      file_url: item.path ?? null
    })));

    if (d.guarantors?.length) {
      await supabase.from(GUARANTORS).insert(d.guarantors.slice(0, 2).map((g, index) => ({
        org_id: orgId,
        agent_id: agent.id,
        slot: index + 1,
        guarantor_type: g.guarantorType ?? null,
        full_name: g.fullName,
        relationship: g.relationship ?? null,
        phone: g.phone,
        whatsapp_phone: g.whatsappPhone ?? null,
        email: g.email ?? null,
        address: g.address ?? null,
        occupation: g.occupation ?? null,
        workplace: g.workplace ?? null,
        years_known: g.yearsKnown ?? null,
        reference_statement: g.referenceStatement ?? null,
        id_document_url: g.idDocumentPath ?? null,
        // The applicant SAYS they consented; nobody has verified it. Consent is
        // confirmed on the guarantor call, not by the person who benefits.
        consent_given: false,
        verification_status: "Not Contacted"
      })));
    }

    await supabase.from(LINKS).update({
      submission_count: Number(found.link.submission_count ?? 0) + 1
    }).eq("id", found.link.id);

    res.status(201).json({
      ok: true,
      reference: `PDA-APP-${agentCode.replace(/^PDA-/, "")}`,
      message: "Your application has been received. Someone will call your guarantors and contact you about the next steps."
    });
  } catch {
    res.status(500).json({ error: "Could not submit your application. Please try again." });
  }
});

export default router;
