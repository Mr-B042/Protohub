import { Router } from "express";
import { receiveInboundSms } from "../lib/sms.js";

const router = Router();

router.post("/inbound/:orgId/:secret", async (req, res) => {
  try {
    const message = await receiveInboundSms(
      req.params.orgId,
      req.params.secret,
      (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>
    );
    res.json({ ok: true, action: message.action ?? "logged", id: message.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Inbound SMS processing failed.";
    const status = message.toLowerCase().includes("invalid inbound sms signature") ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

export default router;
