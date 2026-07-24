const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/subscribe") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    // Honeypot: real users never fill this hidden field.
    if (typeof body.company === "string" && body.company.trim() !== "") {
      return json({ ok: true });
    }

    if (!EMAIL_RE.test(email)) {
      return json({ error: "Enter a valid email address." }, 400);
    }

    if (!env.LISTMONK_URL || !env.LISTMONK_LIST_UUID) {
      return json({ error: "Subscription service is not configured." }, 500);
    }

    let listmonkRes;
    try {
      listmonkRes = await fetch(`${env.LISTMONK_URL}/api/public/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: "",
          list_uuids: [env.LISTMONK_LIST_UUID],
        }),
      });
    } catch {
      return json({ error: "Could not reach the subscription service." }, 502);
    }

    if (!listmonkRes.ok) {
      let message = "Could not subscribe right now.";
      try {
        const errBody = await listmonkRes.json();
        if (errBody && typeof errBody.message === "string") message = errBody.message;
      } catch {}
      return json({ error: message }, listmonkRes.status === 400 ? 400 : 502);
    }

    ctx.waitUntil(sendWelcomeEmail(email, env));

    return json({ ok: true });
  },
};

// Best-effort: a failed welcome email shouldn't fail the subscription itself.
async function sendWelcomeEmail(email, env) {
  if (!env.LISTMONK_TX_API_USER || !env.LISTMONK_TX_API_TOKEN || !env.LISTMONK_WELCOME_TEMPLATE_ID) {
    return;
  }
  try {
    const res = await fetch(`${env.LISTMONK_URL}/api/tx`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${env.LISTMONK_TX_API_USER}:${env.LISTMONK_TX_API_TOKEN}`),
      },
      body: JSON.stringify({
        subscriber_email: email,
        template_id: Number(env.LISTMONK_WELCOME_TEMPLATE_ID),
        from_email: env.LISTMONK_FROM_EMAIL,
      }),
    });
    if (!res.ok) {
      console.error("welcome email failed", res.status, await res.text());
    }
  } catch (err) {
    console.error("welcome email error", err);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
