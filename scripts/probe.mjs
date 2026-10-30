import { normalizeUrl } from '../src/actions.mjs';
import { parsePage } from '../src/parser.mjs';
import { request } from '../src/http.mjs';
try {
  const url = normalizeUrl(process.argv[2]);
  const snapshot = parsePage(await request('GET', url), url);
  console.log(JSON.stringify({ url, status: snapshot.status, actions: Object.fromEntries(Object.entries(snapshot.actions).map(([name, a]) => [name, { label: a.label, active: a.active, disabled: a.disabled }])), timeline: snapshot.timeline }, null, 2));
} catch (error) { console.error(`Read-only FCR probe failed: ${error.message}`); process.exitCode = 1; }
