// Konfiguracja Vite (i Vitest).
//
// Wersja gry ma jedno źródło: pole „version” w package.json (zasady w CLAUDE.md). Przy budowaniu trafia do kodu jako
// __APP_VERSION__, a obok niej __BUILD_ID__ – identyfikator tego konkretnego builda (commit z Vercela albo z gita).
// Ten sam opis ląduje w dist/version.json: działająca gra co jakiś czas go pobiera i gdy identyfikator jest inny
// niż jej własny, pokazuje przycisk PRZEŁADUJ (src/game/update.js).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function buildId() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12);
  try { return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* brak gita */ }
  return `t${Date.now().toString(36)}`;
}

export default defineConfig(({ command }) => {
  const build = command === 'build' ? buildId() : 'dev';
  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_ID__: JSON.stringify(build),
    },
    plugins: [{
      name: 'version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version, build })}\n` });
      },
    }],
  };
});
