// ============================================================================
// SDA&CO — Workshop Registration Handler
// Receives form submissions from the sales page and sends them to BOTH:
//   1. Telegram (SDA&Co_Admin Team group) — instant alert
//   2. Airtable "Workshop Leads" (AiSME Course CRM) — CRM record, written
//      DIRECTLY via the Airtable REST API (no Zapier middleman).
// Both fire in parallel via Promise.allSettled, so one failing does not
// block the other. The visitor sees success as long as Telegram succeeds.
//
// Environment variables required (Netlify → Site settings → Environment):
//   TELEGRAM_BOT_TOKEN  — token from @BotFather
//   TELEGRAM_CHAT_ID    — group chat ID (negative number for supergroups)
//   AIRTABLE_TOKEN      — Airtable Personal Access Token with
//                         data.records:write on the AiSME Course CRM base
//
// ⚠️ INTEGRITY CHECK: this file writes leads to Airtable directly. It MUST
// contain "AIRTABLE_TOKEN" and the AIRTABLE_BASE_ID / AIRTABLE_TABLE_ID
// below. If a future redeploy drops the Airtable code, the CRM sync stops
// silently (Telegram still alerts, so no lead is lost — but the record is
// not created). Base and table IDs are not secrets, so they are hardcoded.
// ============================================================================

const AIRTABLE_BASE_ID = "appQd32pSVDnOvP5T";   // AiSME Course CRM
const AIRTABLE_TABLE_ID = "tblSbyJ9qwv1hSK6v";  // Workshop Leads

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
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
    return jsonError("Server not configured", 500);
  }

  // ISO timestamp (UTC) for the Airtable dateTime field; Airtable shows it
  // in the base's timezone (Asia/Phnom_Penh).
  const submittedAtISO = new Date().toISOString();

  // Human-readable timestamp for the Telegram message (Phnom Penh time)
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

  // Task 1: Telegram alert (critical path)
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

  // Task 2: Airtable CRM record (direct REST API write)
  // Maps the form to the "Workshop Leads" table. Source/Status/Workshop are
  // singleSelect fields; the values below match existing options. typecast is
  // on as a safety net so a future option rename degrades gracefully instead
  // of 422-failing the whole write.
  const airtableTask = AIRTABLE_TOKEN
    ? fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            typecast: true,
            records: [
              {
                fields: {
                  Name: name,
                  Phone: phone,
                  Business: business || "",
                  Attendees: attendees,
                  Source: "Sales Page",
                  Status: "New",
                  Workshop: "AI for Business_MasterClass",
                  "Submitted At": submittedAtISO,
                },
              },
            ],
          }),
        }
      ).then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error("Airtable write failed: " + res.status + " " + body);
        }
        return "airtable-ok";
      })
    : Promise.reject(new Error("AIRTABLE_TOKEN not configured"));

  // ---------- Fire both in parallel ----------
  const results = await Promise.allSettled([telegramTask, airtableTask]);

  const telegramResult = results[0];
  const airtableResult = results[1];

  // Log Airtable failures (visible in Netlify function logs) but don't block
  // the user — Telegram is the critical path for lead capture.
  if (airtableResult.status === "rejected") {
    console.error("Airtable CRM sync failed:", airtableResult.reason);
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
