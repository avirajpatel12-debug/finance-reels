// Reads the Markets Briefing tables from the shared cloud store (Upstash Redis). Read only: this project never writes there.
// Keys come from the environment (GitHub secrets in the cloud) or, on the owner's Mac, from ~/.markets-briefing/.env.
// With no keys it falls back to fixtures/sample.json so a dry run works anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile() {
  const file = path.join(os.homedir(), '.markets-briefing', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile();

const URL_ = process.env.KV_REST_API_URL || '';
const TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN || '';
const unpack = (s) => (s == null ? null : JSON.parse(zlib.gunzipSync(Buffer.from(s, 'base64')).toString('utf8')));

export async function loadTables(names) {
  if (!URL_ || !TOKEN || process.env.USE_FIXTURE === '1') {
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'sample.json'), 'utf8'));
    return { source: 'fixture', tables: Object.fromEntries(names.map((n) => [n, fixture[n] ?? null])) };
  }
  const res = await fetch(`${URL_}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify([['MGET', ...names.map((n) => `mb:${n}`)]]) });
  if (!res.ok) throw new Error(`Cloud store error ${res.status}`);
  const [{ result, error }] = await res.json();
  if (error) throw new Error(`Cloud store error: ${error}`);
  return { source: 'cloud', tables: Object.fromEntries(names.map((n, i) => [n, unpack(result[i])])) };
}
