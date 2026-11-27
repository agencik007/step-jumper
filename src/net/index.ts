// Jedna instancja klienta rankingu dla całej gry.
//   produkcja:     serwer na Cloudflare
//   npm run dev:   lokalny serwer (npm run server:dev), żeby testy w przeglądarce nie trafiały do prawdziwego rankingu
//   VITE_API_URL:  nadpisuje oba (np. VITE_API_URL=https://step-jumper-api.step-jumper.workers.dev npm run dev)
import { Live } from './live';
import { LocalStore, Online } from './online';

const PROD_URL = 'https://step-jumper-api.step-jumper.workers.dev';
export const API_URL: string = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : PROD_URL);
export const APP_VERSION = `web-${__APP_VERSION__}`;   // wersja z package.json (vite.config.js)

export const online = new Online({ baseUrl: API_URL, store: new LocalStore(), platform: 'web', appVersion: APP_VERSION });
/** Pokój znajomych na żywo: kto jest teraz w grze i jak mu idzie (WebSocket, live.ts). */
export const live = new Live({ url: `${API_URL.replace(/^http/, 'ws')}/v1/live`, token: () => online.token });

export type { LivePlayer } from './live';
export type { Around, Board, Entry, PeriodKind, Room, RoomBoard, RoomMember, RoomResult, SubmitResult, Ticket } from './online';
