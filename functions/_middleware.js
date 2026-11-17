// Password gate for the whole site (a Cloudflare Pages Function). Every request passes through here first.
// Nothing is served without one of:
//   - the session cookie you get after typing the app password once on a device, or
//   - the deploy key, which the publishing job uses to read back the reels that are already on the site.
// The settings live in the site's private secrets, never in this code:
//   APP_PASSWORD_HASH  SHA-256 of (APP_SALT + password), as hex. The password itself is not stored anywhere.
//   APP_SALT           random text mixed into the hash
//   SESSION_TOKEN      random text; the value of the session cookie
//   DEPLOY_KEY         random text; lets the publishing job read files
const COOKIE = 'fr_session';
// Needed by the phone to add the app to the Home Screen. They contain nothing private.
const OPEN = new Set(['/manifest.webmanifest', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/favicon.ico']);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
// Compares the whole string every time, so the time taken gives nothing away.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function cookieOf(request) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return '';
}

export async function onRequest({ request, env, next }) {
  if (!env.APP_PASSWORD_HASH || !env.APP_SALT || !env.SESSION_TOKEN) return new Response('This site is not set up yet.', { status: 503 });
  const url = new URL(request.url);
  if (OPEN.has(url.pathname)) return next();
  if (same(request.headers.get('x-deploy-key') || '', env.DEPLOY_KEY || '')) return next();
  if (same(cookieOf(request), env.SESSION_TOKEN)) return next();

  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const password = String(form?.get('password') || '');
    if (password && same(await sha256(env.APP_SALT + password), env.APP_PASSWORD_HASH)) {
      return new Response(null, {
        status: 303,
        headers: { Location: '/', 'Set-Cookie': `${COOKIE}=${env.SESSION_TOKEN}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`, 'Cache-Control': 'no-store' },
      });
    }
    await new Promise((r) => setTimeout(r, 1500)); // slows down guessing
    return signIn('That password is not right. Try again.');
  }
  // Pages get the sign-in screen; videos and data get a plain refusal.
  const wantsPage = request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
  return wantsPage ? signIn('') : new Response('Sign in first.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

function signIn(message) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="theme-color" content="#F6EBDD">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Reels">
<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-180.png">
<title>Finance Reels</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #F6EBDD; color: #2B1B17; font: 600 17px/1.4 ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif; padding: 24px; }
  form { width: min(360px, 100%); background: #FFF9F0; border: 4px solid #2B1B17; border-radius: 22px; box-shadow: 7px 7px 0 #2B1B17; padding: 26px 22px 22px; }
  h1 { margin: 0 0 4px; font-size: 26px; font-weight: 800; color: #8E2F33; }
  p { margin: 0 0 18px; color: #6E5F58; }
  input { width: 100%; font: inherit; font-size: 18px; padding: 13px 14px; border: 3px solid #2B1B17; border-radius: 14px; background: #fff; color: #2B1B17; }
  button { width: 100%; margin-top: 14px; font: inherit; font-weight: 800; font-size: 18px; padding: 13px; border: 3px solid #2B1B17; border-radius: 14px; background: #8E2F33; color: #fff; }
  .err { margin: 14px 0 0; color: #C8372D; }
</style></head><body>
<form method="post" action="/login">
  <h1>Finance Reels</h1>
  <p>Enter your password to watch.</p>
  <input type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required autofocus>
  <button type="submit">Open</button>
  ${message ? `<p class="err" role="alert">${message}</p>` : ''}
</form></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
