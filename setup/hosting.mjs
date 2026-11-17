// One-time setup of the private site on Cloudflare Pages. Run on the Mac:
//   node setup/hosting.mjs              create the site, choose the app password, store the settings
//   node setup/hosting.mjs --password   only change the app password (signs every device out)
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in ~/.markets-briefing/.env.
//
// The app password is typed into a pop-up box on this Mac. It is never printed, saved or sent anywhere as typed:
// only a scrambled fingerprint of it (a salted hash) is stored, on Cloudflare, so the site can check what you type.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../pipeline/data.js'; // also loads ~/.markets-briefing/.env

const ENV_FILE = path.join(os.homedir(), '.markets-briefing', '.env');
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const NAME = process.env.PAGES_PROJECT || 'finance-reels';
const onlyPassword = process.argv.includes('--password');
if (!TOKEN || !ACCOUNT) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are missing from ~/.markets-briefing/.env');

const random = () => crypto.randomBytes(24).toString('hex');
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
// A pop-up box on the Mac with a hidden text field. Returns null if cancelled or left unanswered for 15 minutes.
function ask(prompt) {
  const script = `set r to display dialog ${JSON.stringify(prompt)} default answer "" with hidden answer with title "Finance Reels" buttons {"Cancel", "Save"} default button "Save" giving up after 900
if gave up of r then error "timed out"
return text returned of r`;
  const out = spawnSync('osascript', ['-e', 'tell me to activate', '-e', script], { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.replace(/\n$/, '') : null;
}
function choosePassword() {
  let note = '';
  for (let tries = 0; tries < 5; tries++) {
    const first = ask(`${note}Choose a password for your Finance Reels app.\n\nYou will type it once on your iPhone. At least 8 characters.`);
    if (first == null) return null;
    if (first.length < 8) { note = 'That was shorter than 8 characters.\n\n'; continue; }
    const second = ask('Type the same password again to confirm.');
    if (second == null) return null;
    if (second === first) return first;
    note = 'Those two did not match.\n\n';
  }
  return null;
}

// 1. The site itself
let project = await cf('GET', `/pages/projects/${NAME}`);
if (!project.ok && !onlyPassword) {
  project = await cf('POST', '/pages/projects', { name: NAME, production_branch: 'main' });
  if (!project.ok) throw new Error(`Could not create the site: ${project.error || project.status}`);
  console.log('Created the site on Cloudflare.');
} else if (project.ok) console.log('The site already exists on Cloudflare.');
else throw new Error(`Could not find the site: ${project.error || project.status}`);
const siteUrl = `https://${project.result.subdomain}`;

// 2. The app password (typed into a pop-up box, never shown)
console.log('Waiting for the password box on the Mac...');
const password = choosePassword();
if (password == null) {
  console.log('No password was chosen, so nothing was changed.');
  process.exit(2);
}
const salt = random();
const secrets = {
  APP_SALT: salt,
  APP_PASSWORD_HASH: crypto.createHash('sha256').update(salt + password).digest('hex'),
  SESSION_TOKEN: random(), // new on every password change, which signs every device out
  DEPLOY_KEY: process.env.DEPLOY_KEY || random(),
};

// 3. Store the site's private settings on Cloudflare (through a short-lived private file that is deleted right away)
const tmp = path.join(os.tmpdir(), `fr-secrets-${process.pid}.json`);
try {
  fs.writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
  const out = spawnSync('npx', ['wrangler', 'pages', 'secret', 'bulk', tmp, `--project-name=${NAME}`], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  if (out.status !== 0) throw new Error(`Could not store the site settings: ${(out.stderr || out.stdout).replace(/\s+/g, ' ').slice(-300)}`);
} finally {
  fs.rmSync(tmp, { force: true });
}
console.log('Stored the password fingerprint and site settings on Cloudflare.');

// 4. What the publishing job needs, on this Mac
saveEnv({ PAGES_PROJECT: NAME, SITE_URL: siteUrl, DEPLOY_KEY: secrets.DEPLOY_KEY });
console.log(`Saved the site details in the keys file. Site address: ${siteUrl}`);
console.log('The new settings take effect with the next publish.');
