// Generuje src/sim/jumpTable.ts – tablicę wartości k^1.4.
// Liczby są wpisane do kodu, bo Math.pow może dawać minimalnie różne wyniki w różnych wersjach silnika JS,
// a symulacja na telefonie i na serwerze musi liczyć identycznie co do bitu.
import { writeFileSync } from 'node:fs';

const N = 512, POW = 1.4;
const vals = [];
for (let i = 0; i <= N; i++) vals.push(i === 0 ? '0' : i === N ? '1' : String(Number(Math.pow(i / N, POW).toFixed(12))));
const rows = [];
for (let i = 0; i < vals.length; i += 8) rows.push('  ' + vals.slice(i, i + 8).join(', ') + ',');

writeFileSync(new URL('../src/sim/jumpTable.ts', import.meta.url), `// PLIK GENEROWANY: node scripts/gen-jump-table.mjs – nie edytować ręcznie.
// Zmiana tych wartości zmienia fizykę skoku, więc wymaga podbicia SIM_VERSION.
export const JUMP_TABLE_SIZE = ${N};
export const JUMP_TABLE: readonly number[] = [
${rows.join('\n')}
];
`);
console.log(`jumpTable.ts: ${vals.length} wartości`);
