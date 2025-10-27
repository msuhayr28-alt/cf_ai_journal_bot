import { JournalEntry } from "./journal";
import { JournalRoom } from "./journal";


/** Narrow roles for message typing */
type Role = "system" | "user" | "assistant";

/** Expected JSON body for /api/chat */
interface ChatRequest {
  roomId?: string;
  user?: string;
  message?: string;
}

interface Env {
  AI: Ai;                          // Workers AI binding (add "ai": { "binding": "AI" } in wrangler.jsonc)
  JOURNAL_ROOM: DurableObjectNamespace; // Durable Object namespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    // Simple health check
    if (url.pathname === "/api/health") {
      return json({ ok: true }, 200);
    }

    // --- Chat endpoint ------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/chat") {
      const raw = await request.json().catch(() => ({}));
      const body = raw as ChatRequest;

      const roomId = (body.roomId ?? "default").toString();
      const userName = body.user?.toString();
      const message = (body.message ?? "").toString().trim();

      if (!message) return json({ error: "Missing 'message'." }, 400);

      // Durable Object for per-room memory
      const id = env.JOURNAL_ROOM.idFromName(roomId);
      const stub = env.JOURNAL_ROOM.get(id);

      // Append user message
      await stub.fetch("https://do/append", {
        method: "POST",
        body: JSON.stringify(
          {
            role: "user",
            content: message,
            ts: Date.now(),
          } as JournalEntry
        ),
      });

      // Get history to build prompt
      const histResp = await stub.fetch("https://do/history");
      const history = (await histResp.json()) as JournalEntry[];

      const systemPrompt =
        "You are a calm, supportive journaling companion. Reflect feelings, ask gentle follow-ups, avoid clinical diagnoses, and keep replies concise unless asked.";

      const messages: Array<{ role: Role; content: string }> = [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role as Role, content: m.content })),
      ];

      // Call Workers AI (you can swap the model later if needed)
      const aiResp: any = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages,
      } as any);

      const replyText =
        aiResp?.response ||
        aiResp?.result ||
        aiResp?.choices?.[0]?.message?.content ||
        "I'm here and listening.";

      // Append assistant reply
      await stub.fetch("https://do/append", {
        method: "POST",
        body: JSON.stringify(
          {
            role: "assistant",
            content: replyText,
            ts: Date.now(),
          } as JournalEntry
        ),
      });

      // Return latest conversation
      const finalHistResp = await stub.fetch("https://do/history");
      const finalHistory = (await finalHistResp.json()) as JournalEntry[];
      return json({ reply: replyText, messages: finalHistory }, 200);
    }
    // -----------------------------------------------------------------------

    // Serve inline minimal UI at "/" if you don't place an index.html in /public
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(await STATIC_INDEX_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", ...cors() },
      });
    }

    return new Response("Not found", { status: 404, headers: cors() });
  },
};



function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Minimal inline HTML (optional). If you have /public/index.html, that will be used instead.
const STATIC_INDEX_HTML = Promise.resolve(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Journal Bot</title>
<link rel="stylesheet" href="/style.css" />
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background:#0b1220; color:#eee; margin:0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px; }
  .row { display:flex; gap:8px; }
  input, button { padding:10px 12px; border-radius:12px; border:1px solid #2a3c64; background:#0f172a; color:#eee; }
  button { cursor:pointer; }
  .messages { display:flex; flex-direction:column; gap:10px; margin-top:16px; }
  .bubble { padding:10px 12px; border-radius:12px; max-width:75%; }
  .user { background:#1d4ed8; align-self:flex-end; }
  .assistant { background:#1e293b; align-self:flex-start; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>AI Journal Bot</h1>
    <div class="row">
      <input id="room" placeholder="room id" value="demo" />
      <input id="user" placeholder="your name (optional)" />
    </div>
    <div class="messages" id="list"></div>
    <div class="row" style="margin-top:8px">
      <input id="msg" placeholder="Type a journal entry and press Enter…" style="flex:1" />
      <button id="send">Send</button>
    </div>
  </div>
<script>
const list = document.getElementById("list");
const room = document.getElementById("room");
const user = document.getElementById("user");
const msg = document.getElementById("msg");
const send = document.getElementById("send");

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = "bubble " + role;
  div.textContent = text;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

async function sendMessage() {
  const text = msg.value.trim();
  if (!text) return;
  addBubble("user", text);
  msg.value = "";
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: room.value || "default",
      user: user.value || "anon",
      message: text
    })
  });
  const data = await resp.json();
  addBubble("assistant", data.reply || "(no reply)");
}

send.onclick = sendMessage;
msg.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
</script>
</body>
</html>`);

export { JournalRoom } from './journal'; // expose DO class so Wrangler can bind it