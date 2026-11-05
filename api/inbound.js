// api/inbound.js (Vercel Serverless Webhook Handler)
import crypto from "node:crypto";

function cleanEmailBody(rawText) {
  if (!rawText) return "";
  let text = rawText.replace(/\r\n/g, "\n").trim();
  const quoteMatch = text.match(/^(?:On|Le|Am|El|Op)\s+.{1,250}\s+(?:wrote|écrit|geschrieben|escribió):/im) 
    || text.match(/^-{3,}\s*(?:Original Message|Forwarded message)\s*-{3,}/im);
  if (quoteMatch && quoteMatch.index !== undefined) {
    text = text.slice(0, quoteMatch.index).trim();
  }
  const sigMatch = text.match(/^Sent from my (?:iPhone|iPad|Android)|^Get Outlook for|^(?:Best regards|Warm regards|Best|Thanks),/im);
  if (sigMatch && sigMatch.index !== undefined && sigMatch.index > 0) {
    text = text.slice(0, sigMatch.index).trim();
  }
  return text;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const payload = req.body || {};
  const from = payload.from || "user@example.com";
  const subject = payload.subject || "No Subject";
  const rawBody = payload.text || payload.html || "";
  const originalMessageId = payload.headers?.["message-id"] || payload.message_id || `<inbound-${Date.now()}@domain>`;
  const existingReferences = payload.headers?.["references"] || "";

  // 1. Clean the incoming body to isolate the user's latest statement
  const cleanPrompt = cleanEmailBody(rawBody);

  // 2. Mock or real AI agent generation
  const agentResponse = `Hi there,\n\nThanks for reaching out about "${subject}". I received your message:\n\n> "${cleanPrompt}"\n\nI've routed this to our team and updated your ticket status.\n\nBest,\nResend Autonomous Assistant`;

  // 3. Preserve RFC 5322 Threading Headers for Gmail & Apple Mail
  const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
  const newReferences = existingReferences ? `${existingReferences} ${originalMessageId}` : originalMessageId;
  const newGeneratedMessageId = `<agent-${crypto.randomUUID()}@resend-agent.dev>`;

  const outgoingPayload = {
    from: process.env.AGENT_FROM_EMAIL || "agent@resend-agent.dev",
    to: [from],
    subject: replySubject,
    text: agentResponse,
    headers: {
      "Message-ID": newGeneratedMessageId,
      "In-Reply-To": originalMessageId,
      "References": newReferences,
      "X-Resend-Agent": "1.0",
    },
  };

  // 4. Dispatch via Resend API if API Key is configured
  let dispatchResult = { sent: false, simulated: true };
  if (process.env.RESEND_API_KEY) {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(outgoingPayload),
    });
    dispatchResult = await resendRes.json();
  }

  return res.status(200).json({
    success: true,
    cleanPrompt,
    threadHeaders: outgoingPayload.headers,
    dispatchResult,
  });
}
