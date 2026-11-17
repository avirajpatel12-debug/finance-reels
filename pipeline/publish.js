// Publishes finished reels to the private site (Cloudflare Pages).
// The whole site is rebuilt in dist/ each time: the app's page, every reel still inside the keep window, and
// manifest.json (the list the app reads). Reels made by earlier runs are fetched back from the live site with the
// deploy key, so finished videos are never stored anywhere public.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './data.js';

const SITE = (process.env.SITE_URL || '').replace(/\/+$/, '');
const KEY = process.env.DEPLOY_KEY || '';
const PROJECT = process.env.PAGES_PROJECT || '';
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 7);
// Bump this when the look of the reels changes, so already-published reels are made again.
const RENDER_VERSION = 1;
export const hosting = Boolean(SITE && KEY && PROJECT && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
const dist = path.join(ROOT, 'dist');
const fromSite = (rel) => fetch(`${SITE}/${rel}`, { headers: { 'x-deploy-key': KEY } });

// A fingerprint of everything that decides how a reel looks and sounds. Same fingerprint = no need to make it again.
export function reelHash(reel) {
  const core = { v: RENDER_VERSION, voice: process.env.VOICE || '', title: reel.title, dateLabel: reel.dateLabel, footer: reel.footer, scenes: reel.scenes.map((s) => ({ type: s.type, narration: s.narration, visual: s.visual })) };
  return crypto.createHash('sha1').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

// The list of reels on the site right now. null when hosting is not set up.
// A read that fails stops the run: publishing with a wrong list would wipe the reels already there.
export async function liveManifest() {
  if (!hosting) return null;
  let res;
  try {
    res = await fromSite('manifest.json');
  } catch (err) {
    if (process.env.FIRST_PUBLISH === '1') return { reels: [] };
    throw new Error(`Could not reach the site to read its reel list (${err.cause?.code || err.message}).`);
  }
  if (res.status === 404 || (process.env.FIRST_PUBLISH === '1' && !res.ok)) return { reels: [] }; // nothing published yet
  if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error(`Could not read the site's reel list (HTTP ${res.status}).`);
  return res.json();
}

// items: [{ reel, hash, video, poster }] where video and poster are files in out/.
export async function publish(items, live) {
  const result = await assemble(items, live);
  await deploy();
  return result;
}

// Builds the site folder (dist/) without uploading it. Also used to preview the site on this Mac.
export async function assemble(items, live) {
  const now = Date.now();
  fs.rmSync(dist, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'app'), dist, { recursive: true });
  fs.mkdirSync(path.join(dist, 'reels'), { recursive: true });

  const fresh = new Set(items.map((i) => i.reel.id));
  const kept = [];
  let dropped = 0;
  for (const r of live?.reels || []) {
    if (fresh.has(r.id)) continue; // a newer version is being published now
    if (now - new Date(r.createdAt).getTime() > KEEP_DAYS * 864e5) continue; // past the keep window
    try {
      for (const rel of [r.video, r.poster]) {
        if (!/^reels\/[\w.-]+$/.test(rel)) throw new Error('unexpected file name');
        const res = await fromSite(rel);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(path.join(dist, rel), Buffer.from(await res.arrayBuffer()));
      }
      kept.push(r);
    } catch {
      dropped++;
    }
  }

  const added = items.map(({ reel, hash, video, poster }) => {
    // The file name carries a fingerprint of the video, so a remade reel is never confused with a cached old one.
    const tag = crypto.createHash('sha1').update(fs.readFileSync(video)).digest('hex').slice(0, 10);
    const names = { video: `reels/${reel.id}.${tag}.mp4`, poster: `reels/${reel.id}.${tag}.jpg` };
    fs.copyFileSync(video, path.join(dist, names.video));
    fs.copyFileSync(poster, path.join(dist, names.poster));
    return { id: reel.id, kind: reel.kind, title: reel.title, dateLabel: reel.dateLabel, asOf: reel.footer.asOf, source: reel.footer.source, sources: reel.sources, duration: Math.round(reel.duration * 10) / 10, ticker: reel.ticker, hash, createdAt: new Date().toISOString(), ...names };
  });

  const reels = [...added, ...kept].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const board = reels.find((r) => r.kind === 'scoreboard');
  const manifest = { updatedAt: new Date().toISOString(), ticker: board?.ticker || [], tickerAsOf: board?.asOf || '', reels };
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest));
  return { total: reels.length, added: added.length, kept: kept.length, dropped };
}

// Uploads dist/ (and the password gate in functions/) with Cloudflare's own tool. Addresses are kept out of the log.
function deploy() {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'pages', 'deploy', 'dist', `--project-name=${PROJECT}`, '--branch=main', '--commit-dirty=true'], {
      cwd: ROOT,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: process.env.CI || '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Publishing failed: ${out.replace(/https?:\/\/\S+/g, '[address hidden]').replace(/\s+/g, ' ').slice(-400)}`))));
  });
}
