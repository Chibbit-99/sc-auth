import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET")!;

function cors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "content-type");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  return new Response(res.body, { status: res.status, headers });
}

function json(data: unknown, status = 200) {
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// verify Turnstile token
async function verifyTurnstile(token: string, ip: string) {
  const form = new FormData();
  form.append("secret", TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );

  return await res.json();
}

function getIP(req: Request) {
  return (
    req.headers.get("x-forwarded-for") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  if (req.method !== "POST") {
    return json({ error: "Use POST" }, 405);
  }

  const { email, html, fallback, token } = await req.json();
  if (!email || !token) {
    return json({ error: "Missing email or token" }, 400);
  }

  const ip = getIP(req);

  // verify captcha
  const verify = await verifyTurnstile(token, ip);

  if (!verify.success) {
    return json({
      success: false,
      error: "Turnstile verification failed",
    }, 403);
  }

  // send email
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
      to: email,
      subject: "Message from API",
      content: fallback ?? "HTML email",
      html: html ?? undefined,
    });

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});
