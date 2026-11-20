// Jedna instancja klienta rankingu dla całej gry.
//   produkcja:     serwer na Cloudflare
//   npm run dev:   lokalny serwer (npm run server:dev), żeby testy w przeglądarce nie trafiały do prawdziwego rankingu
//   VITE_API_URL:  nadpisuje oba (np. VITE_API_URL=https://step-jumper-api.step-jumper.workers.dev npm run dev)
import { LocalStore, Online } from './online';

const PROD_URL = 'https://step-jumper-api.step-jumper.workers.dev';
export const API_URL: string = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : PROD_URL);
export const APP_VERSION = 'web-0.4.0';

export const online = new Online({ baseUrl: API_URL, store: new LocalStore(), platform: 'web', appVersion: APP_VERSION });

export type { Around, Board, Entry, PeriodKind, SubmitResult, Ticket } from './online';
