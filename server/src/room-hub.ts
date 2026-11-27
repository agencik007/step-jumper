// Durable Object pokoju znajomych: WebSockety obecnych graczy (lista online i ich stan). Logika – hub.ts.
// WebSockety w trybie hibernacji: między wiadomościami obiekt może być uśpiony i nie zużywa czasu pracy;
// stan graczy leży w załącznikach gniazd, które przeżywają uśpienie.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { Hub } from './hub';

export class RoomHub extends DurableObject<Env> {
  private readonly hub = new Hub(() => this.ctx.getWebSockets());

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/kick') {
      const { pid } = await req.json<{ pid: string }>();
      this.hub.kick(pid);
      return new Response(null, { status: 204 });
    }
    // /connect: Worker sprawdził już token i członkostwo; dane gracza przychodzą w nagłówku
    const who = JSON.parse(req.headers.get('x-player') ?? 'null');
    if (!who) return new Response(null, { status: 400 });
    if (!this.hub.hasRoom) return new Response(null, { status: 429 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.hub.join(server, who);
    // przeglądarka wysłała protokoły ['sj', token] – odpowiadamy samym 'sj' (bez tego połączenie się nie uda)
    return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'sj' } });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> { this.hub.message(ws, msg); }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.hub.close(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* już zamknięte */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> { this.hub.close(ws); }
}
