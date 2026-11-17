// Lets iPhones play the videos.
// Cloudflare Pages always answers a request for a file with the whole file. Safari on iPhone only plays a video if the
// server can also send just the part it asks for (a "range" request, answered with status 206). This adds that, by
// passing on only the requested bytes of the file. It runs only for the video folder (see _routes.json, written by
// pipeline/publish.js), and it never decides who may see what: a file that is not on the site is still "not found".
export async function onRequest({ request, next }) {
  const res = await next();
  if (res.status !== 200) return res;
  const headers = new Headers(res.headers);
  headers.set('Accept-Ranges', 'bytes');
  const m = (request.headers.get('Range') || '').match(/^bytes=(\d*)-(\d*)$/); // one range only; anything else gets the whole file
  if (!m || (!m[1] && !m[2]) || request.method !== 'GET') return new Response(res.body, { status: 200, headers });
  // Cloudflare does not always say how big the file is, so when it does not, read the file (a few MB) and measure it.
  let size = Number(res.headers.get('Content-Length'));
  let whole = null;
  if (!size) {
    whole = new Uint8Array(await res.arrayBuffer());
    size = whole.byteLength;
  }
  if (!size) return new Response(whole, { status: 200, headers });

  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2])); // "the last N bytes"
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    if (!whole) res.body?.cancel();
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
  }

  const length = end - start + 1;
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(length));
  if (whole) return new Response(whole.subarray(start, end + 1), { status: 206, headers });
  let pos = 0;
  const cut = new TransformStream({
    transform(chunk, controller) {
      const from = pos;
      pos += chunk.byteLength;
      if (pos <= start) return; // before the part asked for
      controller.enqueue(chunk.subarray(Math.max(0, start - from), Math.min(chunk.byteLength, end + 1 - from)));
      if (pos > end) controller.terminate(); // done: stop reading the rest of the file
    },
  });
  // A fixed-length body keeps the exact size in the reply, which Safari expects.
  const out = typeof FixedLengthStream === 'function' ? new FixedLengthStream(length) : new TransformStream();
  res.body.pipeThrough(cut).pipeTo(out.writable).catch(() => {});
  return new Response(out.readable, { status: 206, headers });
}
