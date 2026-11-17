// One-time setup of the site on Cloudflare Pages. Run on the Mac:  node setup/hosting.mjs
// The site has no password. Everything lives inside a folder with a long random name, and the full link
// (SITE_URL/SITE_KEY/) is the only way in. Running this again keeps the same link.
// To change the link (if it ever leaks): delete SITE_KEY from the keys file, run this again, then publish once with
// FIRST_PUBLISH=1. Reels made before the change are dropped.
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in ~/.markets-briefing/.env.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../pipeline/data.js'; // loads ~/.markets-briefing/.env

const ENV_FILE = path.join(os.homedir(), '.markets-briefing', '.env');
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const NAME = process.env.PAGES_PROJECT || 'finance-reels';
if (!TOKEN || !ACCOUNT) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are missing from ~/.markets-briefing/.env');

function saveEnv(pairs) {
  const keep = fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => l.trim() && !Object.keys(pairs).some((k) => l.startsWith(`${k}=`)));
  for (const [k, v] of Object.entries(pairs)) keep.push(`${k}=${v}`);
  fs.writeFileSync(`${ENV_FILE}.tmp`, keep.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(`${ENV_FILE}.tmp`, ENV_FILE);
}
async function cf(method, p, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success, status: res.status, result: json.result, error: (json.errors || []).map((e) => e.message).join('; ') };
}

let project = await cf('GET', `/pages/projects/${NAME}`);
if (!project.ok) {
  project = await cf('POST', '/pages/projects', { name: NAME, production_branch: 'main' });
  if (!project.ok) throw new Error(`Could not create the site: ${project.error || project.status}`);
  console.log('Created the site on Cloudflare.');
} else console.log('The site already exists on Cloudflare.');

const key = process.env.SITE_KEY || crypto.randomBytes(18).toString('base64url'); // 24 random characters
saveEnv({ PAGES_PROJECT: NAME, SITE_URL: `https://${project.result.subdomain}`, SITE_KEY: key });
console.log(process.env.SITE_KEY ? 'Kept the existing secret link.' : 'Made a new secret link.');
console.log('Saved the site details in the keys file. Make the QR code with: node setup/link.mjs');
