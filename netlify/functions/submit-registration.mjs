// ============================================================================
// SDA&CO — Workshop Registration Handler
// Receives form submissions from the sales page and sends them to BOTH:
//   1. Telegram (SDA&Co_Admin Team group) — instant alert
//   2. Zapier webhook → Airtable "Workshop Leads" — CRM record
// Both fire in parallel via Promise.allSettled, so one failing does not
// block the other. The visitor sees success as long as Telegram succeeds.
//
// Environment variables required (Netlify → Site settings → Environment):
//   TELEGRAM_BOT_TOKEN  — token from @BotFather
//   TELEGRAM_CHAT_ID    — group chat ID (negative number for supergroups)
//   ZAPIER_WEBHOOK_URL  — Zapier Catch Hook URL (routes to Airtable)
//
// ⚠️ IMPORTANT: This file MUST contain the Zapier integration. If a future
// redeploy uses an older version of this file without the Zapier code, the
// Airtable sync will silently stop. Quick integrity check: this file should
// contain the word "Zapier" and "ZAPIER_WEBHOOK_URL".
// ============================================================================

export default async (request) => {
  // Only accept POST
  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

  // Parse the submitted form data
  let data;
  try {
    data = await request.json();
  } catch (err) {
    return jsonError("Invalid request body", 400);
  }

  const name = (data.name || "").trim();
  const phone = (data.phone || "").trim();
  const business = (data.business || "").trim();
  const attendees = (data.attendees || "").trim();
  const honeypot = (data.website || "").trim(); // spam trap

  // Bot honeypot — if filled, silently pretend success
  if (honeypot) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validation — Business is optional; Name, Phone, Attendees required
  if (!name || !phone || !attendees) {
    return jsonError("Missing required fields", 400);
  }
  if (name.length > 100 || phone.length > 30 || business.length > 150 || attendees.length > 30) {
    return jsonError("Input too long", 400);
  }

  // Read secrets from Netlify environment
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
    return jsonError("Server not configured", 500);
  }

  // Timestamp in Phnom Penh time
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Phnom_Penh",
    dateStyle: "medium",
    timeStyle: "short",
  });

  // ---------- Build the Telegram message ----------
  const text =
    `<b>NEW WORKSHOP REGISTRATION</b>\n` +
    `<i>AI for Business — Master Class</i>\n` +
    `─────────────────────────\n\n` +
    `<b>Name:</b> ${escapeHtml(name)}\n` +
    `<b>Phone:</b> ${escapeHtml(phone)}\n` +
    `<b>Business:</b> ${escapeHtml(business || "—")}\n` +
    `<b>Attendees:</b> ${escapeHtml(attendees)}\n\n` +
    `<i>Submitted: ${timestamp} (Phnom Penh)</i>\n\n` +
    `<b>Next step:</b> Contact this lead within 24 hours to confirm enrollment and provide payment details.`;

  // ---------- Define both delivery tasks ----------

  // Task 1: Telegram alert
  const telegramTask = fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    }
  ).then(async (res) => {
    const result = await res.json();
    if (!result.ok) throw new Error("Telegram API error: " + JSON.stringify(result));
    return "telegram-ok";
  });

  // Task 2: Zapier webhook → Airtable CRM
  // Auto-tags each record with source + status + timestamp for the CRM pipeline.
  const zapierTask = ZAPIER_WEBHOOK_URL
    ? fetch(ZAPIER_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          phone: phone,
          business: business || "",
          attendees: attendees,
          source: "Sales Page",
          status: "New",
          workshop: "AI for Business · July 2026",
          submitted_at: timestamp,
        }),
      }).then((res) => {
        if (!res.ok) throw new Error("Zapier webhook failed: " + res.status);
        return "zapier-ok";
      })
    : Promise.reject(new Error("ZAPIER_WEBHOOK_URL not configured"));

  // ---------- Fire both in parallel ----------
  const results = await Promise.allSettled([telegramTask, zapierTask]);

  const telegramResult = results[0];
  const zapierResult = results[1];

  // Log Zapier failures (so they show in Netlify function logs) but don't
  // block the user — Telegram is the critical path for lead capture.
  if (zapierResult.status === "rejected") {
    console.error("Zapier/Airtable sync failed:", zapierResult.reason);
  }

  // If Telegram failed, that's a real failure the user should retry.
  if (telegramResult.status === "rejected") {
    console.error("Telegram delivery failed:", telegramResult.reason);
    return jsonError("Could not deliver registration", 502);
  }

  // Success: Telegram delivered (Airtable may or may not have, logged above)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// ---------- helpers ----------
function jsonError(message, status) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const config = {
  path: "/api/register",
};
