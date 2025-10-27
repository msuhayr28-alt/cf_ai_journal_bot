export interface JournalEntry {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export class JournalRoom {
  state: DurableObjectState;
  storage: DurableObjectStorage;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/history") {
      const messages = (await this.storage.get<JournalEntry[]>("entries")) ?? [];
      return new Response(JSON.stringify(messages), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/append") {
      const body = await request.json<JournalEntry>();
      const existing = (await this.storage.get<JournalEntry[]>("entries")) ?? [];
      existing.push(body);
      await this.storage.put("entries", existing);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
