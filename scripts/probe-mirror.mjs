// Spiegelt die Zeile der Probe nach core-content/docs/probe-log.md (Entscheidung 31, Brief 07).
// Läuft nur, wenn das Secret CORE_CONTENT_TOKEN gesetzt ist (Fine-grained Token, Contents Read and write nur auf amrsaad/core-content).
// Ohne Token übernimmt die Wache die Zeilen aus core/pipeline/out/probe/probe-log.md. Das Token steht nie in Ausgaben.
// Aufruf: CONTENT_TOKEN=... node scripts/probe-mirror.mjs <zeilen-datei>
import { readFileSync } from 'node:fs';

const [file] = process.argv.slice(2);
const token = process.env.CONTENT_TOKEN;
if (!token || !file) {
  console.log('probe-mirror: kein Token oder keine Datei, nichts gespiegelt');
  process.exit(0);
}
const line = readFileSync(file, 'utf8').trim();
const api = 'https://api.github.com/repos/amrsaad/core-content/contents/docs/probe-log.md';
const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };

for (let i = 0; i < 4; i++) {
  const g = await fetch(`${api}?ref=claude/content`, { headers });
  if (g.status !== 200) {
    console.log(`probe-mirror: lesen ${g.status}`);
    process.exit(0);
  }
  const cur = await g.json();
  const text = Buffer.from(cur.content, 'base64').toString('utf8');
  if (text.includes(line)) {
    console.log('probe-mirror: Zeile steht schon im Log');
    process.exit(0);
  }
  const next = `${text.replace(/\n*$/, '\n')}${line}\n`;
  const p = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ message: 'probe: Zeile von der Live-Probe', content: Buffer.from(next).toString('base64'), sha: cur.sha, branch: 'claude/content' }) });
  if (p.status === 200 || p.status === 201) {
    console.log('probe-mirror: Zeile geschrieben');
    process.exit(0);
  }
  console.log(`probe-mirror: schreiben ${p.status}${p.status === 409 || p.status === 422 ? ', neuer Versuch' : ''}`);
  if (p.status !== 409 && p.status !== 422) process.exit(0);
}
