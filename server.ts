import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET")!;

const DATABASE_URL = Deno.env.get("DATABASE_URL_SECRET")!;

/**
 * Reads data from a path.
 */
export async function readPath(path: string = ""): Promise<any> {
    const url = `${DATABASE_URL}/${path}.json`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Read failed: ${response.status}`);
    }

    return await response.json();
}

/**
 * Updates data at a path (PATCH).
 */
export async function updatePath(path: string, data: any): Promise<void> {
    const url = `${DATABASE_URL}/${path}.json`;

    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        throw new Error(`Update failed: ${response.status}`);
    }
}

/**
 * Deletes data at a path.
 */
export async function deletePath(path: string): Promise<void> {
    const url = `${DATABASE_URL}/${path}.json`;

    const response = await fetch(url, {
        method: "DELETE"
    });

    if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
    }
}

// ---------------- CORS ----------------

function cors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");

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

// ---------------- IP ----------------

function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

// ---------------- TURNSTILE VERIFY ----------------

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

// ---------------- EMAIL TEMPLATE (INTERNAL) ----------------

function buildEmail(recipient: string) {
  const html = `
    <div style="font-family:Arial;padding:20px;line-height:1.5">
      <h2 style="color:#4f46e5;">Hello 👋</h2>

      <p>This email was automatically sent when you triggered the API.</p>

      <div style="margin-top:20px;padding:15px;background:#f3f4f6;border-radius:8px;">
        <p><b>Recipient:</b> ${recipient}</p>
        <p><b>Status:</b> Success</p>
      </div>

      <p style="margin-top:20px;font-size:12px;color:#666;">
        This is an automated message.
      </p>
    </div>
  `;

  const fallback =
    `Hello! This is an automated email sent to ${recipient}.`;

  return { html, fallback };
}

// ---------------- SERVER ----------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  if (req.method !== "GET") {
    return json({ error: "Use GET" }, 405);
  }

  const url = new URL(req.url);

  const email = url.searchParams.get("email");
  const token = url.searchParams.get("token");

  if (!email || !token) {
    return json({
      success: false,
      error: "Missing ?email and ?token",
    }, 400);
  }

  const ip = getIP(req);

  // ---------------- VERIFY TURNSTILE ----------------

  const verify = await verifyTurnstile(token, ip);

  if (!verify.success) {
    return json({
      success: false,
      error: "Turnstile verification failed",
    }, 403);
  }

  // ---------------- BUILD EMAIL ----------------

  const { html, fallback } = buildEmail(email);

  // ---------------- SEND EMAIL ----------------

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
      subject: "Automated Message",
      content: fallback,
      html,
    });

    return json({
      success: true,
      message: "Email sent",
      to: email,
    });
  } catch (err) {
    return json({
      success: false,
      error: String(err),
    }, 500);
  }
});
