import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const kv = await Deno.openKv();

const WINDOW_MS = 15 * 60 * 1000;

// ---------------- helpers ----------------

function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

function cors(res: Response) {
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
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ---------------- rate limit (KV FIXED) ----------------

async function checkRateLimit(ip: string, email: string) {
  const key = ["rate-limit", ip, email];
  const now = Date.now();

  const record = await kv.get<number>(key);

  if (record.value && now - record.value < WINDOW_MS) {
    return {
      ok: false,
      retry: Math.ceil((WINDOW_MS - (now - record.value)) / 60000),
    };
  }

  await kv.set(key, now);
  return { ok: true };
}

// ---------------- server ----------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  if (req.method !== "GET") {
    return json({ error: "Use GET" }, 405);
  }

  const url = new URL(req.url);
  const recipient = url.searchParams.get("email");
  const html = url.searchParams.get("html");
  const fallback = url.searchParams.get("fallback");

  if (!recipient || (!html && !fallback)) {
    return json({
      success: false,
      error: "Missing ?email and content",
    }, 400);
  }

  const ip = getIP(req);

  // ✅ REAL KV RATE LIMIT (WORKS ACROSS INSTANCES)
  const limit = await checkRateLimit(ip, recipient);

  if (!limit.ok) {
    return json({
      success: false,
      error: "Rate limited",
      retry_in_minutes: limit.retry,
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
      subject: "Message from Deno Deploy",
      content: fallback ?? "Open HTML version",
      html: html ?? undefined,
    });

    return json({
      success: true,
      message: "Email sent",
      to: recipient,
    });
  } catch (err) {
    return json({
      success: false,
      error: String(err),
    }, 500);
  }
});
