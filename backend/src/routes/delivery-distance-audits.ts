import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const coordinateInput = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "string") return Number(value.trim());
  return value;
}, z.number().finite().nullable());

const CoordinatePairSchema = z.object({
  latitude: coordinateInput.optional(),
  longitude: coordinateInput.optional(),
  geoAccuracy: z.string().max(80).optional().nullable(),
  geoSource: z.string().max(80).optional().nullable()
}).superRefine((value, ctx) => {
  const latitude = value.latitude ?? null;
  const longitude = value.longitude ?? null;
  if ((latitude === null) !== (longitude === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Latitude and longitude must be saved together." });
    return;
  }
  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["latitude"], message: "Latitude must be between -90 and 90." });
  }
  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["longitude"], message: "Longitude must be between -180 and 180." });
  }
});

type CoordinatePair = { latitude: number; longitude: number };

function toCoordinatePair(value: { latitude?: unknown; longitude?: unknown } | null | undefined): CoordinatePair | null {
  const latitude = typeof value?.latitude === "number" ? value.latitude : null;
  const longitude = typeof value?.longitude === "number" ? value.longitude : null;
  if (latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function readEnvNumber(key: string, fallback: number) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function haversineMeters(a: CoordinatePair, b: CoordinatePair) {
  const earthMeters = 6_371_000;
  const toRad = (value: number) => value * Math.PI / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const deltaLat = toRad(b.latitude - a.latitude);
  const deltaLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return Math.round(earthMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function googleDirectionsMapUrl(origin: CoordinatePair, destination: CoordinatePair) {
  const originText = encodeURIComponent(`${origin.latitude},${origin.longitude}`);
  const destinationText = encodeURIComponent(`${destination.latitude},${destination.longitude}`);
  return `https://www.google.com/maps/dir/?api=1&origin=${originText}&destination=${destinationText}&travelmode=driving`;
}

function googleDirectionsEmbedUrl(origin: CoordinatePair, destination: CoordinatePair) {
  const originText = encodeURIComponent(`${origin.latitude},${origin.longitude}`);
  const destinationText = encodeURIComponent(`${destination.latitude},${destination.longitude}`);
  return `https://maps.google.com/maps?f=d&saddr=${originText}&daddr=${destinationText}&output=embed`;
}

async function calculateDrivingDistance(origin: CoordinatePair, destination: CoordinatePair, straightLineMeters: number) {
  const key = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!key) {
    return {
      provider: "estimate",
      distanceMeters: Math.max(0, Math.round(straightLineMeters * 1.35)),
      durationSeconds: null as number | null
    };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${origin.latitude},${origin.longitude}`);
  url.searchParams.set("destination", `${destination.latitude},${destination.longitude}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("key", key);

  try {
    const response = await fetch(url);
    const payload: any = await response.json().catch(() => null);
    const leg = payload?.routes?.[0]?.legs?.[0];
    const distanceMeters = Number(leg?.distance?.value);
    const durationSeconds = Number(leg?.duration?.value);
    if (response.ok && Number.isFinite(distanceMeters) && distanceMeters > 0) {
      return {
        provider: "google_directions",
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null
      };
    }
    logger.warn("delivery_distance_google_fallback", { status: payload?.status, error: payload?.error_message });
  } catch (error) {
    logger.warn("delivery_distance_google_error", { error: error instanceof Error ? error.message : String(error) });
  }

  return {
    provider: "estimate",
    distanceMeters: Math.max(0, Math.round(straightLineMeters * 1.35)),
    durationSeconds: null as number | null
  };
}

function expectedFeeForDistance(distanceMeters: number) {
  const baseFee = readEnvNumber("DELIVERY_AUDIT_BASE_FEE", 1500);
  const perKmFee = readEnvNumber("DELIVERY_AUDIT_PER_KM", 250);
  const freeKm = readEnvNumber("DELIVERY_AUDIT_FREE_KM", 3);
  const roundTo = Math.max(1, readEnvNumber("DELIVERY_AUDIT_ROUND_TO", 100));
  const km = Math.max(0, distanceMeters / 1000);
  const raw = baseFee + Math.max(0, km - freeKm) * perKmFee;
  return Math.round(raw / roundTo) * roundTo;
}

function riskFor(chargedFee: number, expectedFee: number) {
  if (!Number.isFinite(chargedFee) || chargedFee <= 0) return "missing";
  const variance = chargedFee - expectedFee;
  const variancePercent = expectedFee > 0 ? (variance / expectedFee) * 100 : 0;
  if (variance >= 1000 && variancePercent >= 50) return "suspicious";
  if (variance >= 500 && variancePercent >= 20) return "watch";
  return "fair";
}

router.get("/", requireRole("Owner", "Admin", "Manager", "Inventory Manager"), async (req, res) => {
  const orderIds = typeof req.query.orderIds === "string"
    ? req.query.orderIds.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 500)
    : [];
  let query = supabase
    .from("delivery_distance_audits")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (orderIds.length > 0) query = query.in("order_id", orderIds);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

router.patch("/orders/:orderId/coordinates", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const parsed = CoordinatePairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const latitude = parsed.data.latitude ?? null;
  const longitude = parsed.data.longitude ?? null;
  const { data, error } = await supabase
    .from("orders")
    .update({
      latitude,
      longitude,
      geo_accuracy: parsed.data.geoAccuracy?.trim() || null,
      geo_source: parsed.data.geoSource?.trim() || "manual",
      updated_at: new Date().toISOString()
    })
    .eq("id", req.params.orderId)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Order not found." }); return; }
  res.json(data);
});

router.patch("/agent-locations/:locationId/coordinates", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const parsed = CoordinatePairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const latitude = parsed.data.latitude ?? null;
  const longitude = parsed.data.longitude ?? null;
  const { data, error } = await supabase
    .from("agent_locations")
    .update({ latitude, longitude })
    .eq("id", req.params.locationId)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Agent location not found." }); return; }
  res.json(data);
});

router.post("/orders/:orderId/calculate", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const coordinatePatch = req.body && Object.prototype.hasOwnProperty.call(req.body, "latitude")
    ? CoordinatePairSchema.safeParse(req.body)
    : null;
  if (coordinatePatch && !coordinatePatch.success) {
    res.status(400).json({ error: coordinatePatch.error.flatten().fieldErrors });
    return;
  }

  if (coordinatePatch?.success) {
    await supabase
      .from("orders")
      .update({
        latitude: coordinatePatch.data.latitude ?? null,
        longitude: coordinatePatch.data.longitude ?? null,
        geo_accuracy: coordinatePatch.data.geoAccuracy?.trim() || null,
        geo_source: coordinatePatch.data.geoSource?.trim() || "manual",
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.orderId)
      .eq("org_id", req.user!.orgId);
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, org_id, agent_id, agent_location_id, customer, address, city, state, logistics_cost, latitude, longitude")
    .eq("id", req.params.orderId)
    .eq("org_id", req.user!.orgId)
    .single();
  if (orderError) { res.status(orderError.code === "PGRST116" ? 404 : 500).json({ error: orderError.code === "PGRST116" ? "Order not found." : orderError.message }); return; }
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }

  let locationQuery = supabase
    .from("agent_locations")
    .select("id, agent_id, name, state, city, latitude, longitude")
    .eq("org_id", req.user!.orgId);
  if (order.agent_location_id) {
    locationQuery = locationQuery.eq("id", order.agent_location_id).limit(1);
  } else if (order.agent_id) {
    locationQuery = locationQuery.eq("agent_id", order.agent_id).order("is_primary", { ascending: false }).order("created_at", { ascending: true }).limit(1);
  } else {
    res.status(400).json({ error: "Assign this order to an agent hub before calculating distance.", missing: ["agent_hub"] });
    return;
  }
  const { data: locations, error: locationError } = await locationQuery;
  if (locationError) { res.status(500).json({ error: locationError.message }); return; }
  const location = Array.isArray(locations) ? locations[0] : null;
  if (!location) {
    res.status(400).json({ error: "No agent hub found for this order.", missing: ["agent_hub"] });
    return;
  }

  const origin = toCoordinatePair(location);
  const destination = toCoordinatePair(order);
  const missing: string[] = [];
  if (!origin) missing.push("hub_coordinates");
  if (!destination) missing.push("customer_coordinates");
  if (missing.length > 0) {
    res.status(400).json({
      error: "Add hub and customer GPS coordinates before calculating distance.",
      missing,
      orderId: order.id,
      agentLocationId: location.id
    });
    return;
  }

  const straightLineMeters = haversineMeters(origin!, destination!);
  const driving = await calculateDrivingDistance(origin!, destination!, straightLineMeters);
  const chargedFee = Number(order.logistics_cost ?? 0);
  const expectedFee = expectedFeeForDistance(driving.distanceMeters);
  const varianceAmount = Math.round((chargedFee - expectedFee) * 100) / 100;
  const variancePercent = expectedFee > 0 ? Math.round((varianceAmount / expectedFee) * 10_000) / 100 : null;
  const risk = riskFor(chargedFee, expectedFee);

  const auditPayload = {
    org_id: req.user!.orgId,
    order_id: order.id,
    agent_id: order.agent_id,
    agent_location_id: location.id,
    origin_latitude: origin!.latitude,
    origin_longitude: origin!.longitude,
    destination_latitude: destination!.latitude,
    destination_longitude: destination!.longitude,
    distance_meters: driving.distanceMeters,
    duration_seconds: driving.durationSeconds,
    straight_line_meters: straightLineMeters,
    provider: driving.provider,
    map_url: googleDirectionsMapUrl(origin!, destination!),
    embed_map_url: googleDirectionsEmbedUrl(origin!, destination!),
    expected_fee: expectedFee,
    charged_fee: chargedFee,
    variance_amount: varianceAmount,
    variance_percent: variancePercent,
    risk,
    created_by: req.user!.id
  };

  const { data: audit, error: auditError } = await supabase
    .from("delivery_distance_audits")
    .upsert(auditPayload, { onConflict: "org_id,order_id" })
    .select()
    .single();
  if (auditError) { res.status(500).json({ error: auditError.message }); return; }
  res.json(audit);
});

export default router;
