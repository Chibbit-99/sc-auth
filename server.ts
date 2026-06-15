import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// IP → last sent timestamp
const rateLimitMap = new Map<string, number>();
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function getClientIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

function setCORS(res: Response) {
  const headers = new Headers(res.headers);

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");

  return new Response(res.body, {
    status: res.status,
    headers,
  });
}

function json(data: unknown, status = 200) {
  return setCORS(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return setCORS(new Response(null, { status: 204 }));
  }

  const url = new URL(req.url);
  const recipient = url.searchParams.get("email");

  if (!recipient) {
    return json({ success: false, error: "Missing ?email=" }, 400);
  }

  // --- IP RATE LIMIT ---
  const ip = getClientIP(req);
  const now = Date.now();
  const lastSent = rateLimitMap.get(ip);

  if (lastSent && now - lastSent < WINDOW_MS) {
    const waitMinutes = Math.ceil((WINDOW_MS - (now - lastSent)) / 60000);

    return json({
      success: false,
      error: "Rate limit exceeded",
      retry_in_minutes: waitMinutes,
    }, 429);
  }

  try {
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: Deno.env.get("GMAIL_USER")!,
          password: Deno.env.get("GMAIL_APP_PASSWORD")!,
        },
      },
    });

    await client.send({
      from: Deno.env.get("GMAIL_USER")!,
      to: recipient,
      subject: "Hello from Deno Deploy",
      content: "This email was triggered by visiting your endpoint.",
    });

    rateLimitMap.set(ip, now);

    return json({
      success: true,
      message: "Email sent",
      to: recipient,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);

    return json({
      success: false,
      error: String(err),
    }, 500);
  }
});
