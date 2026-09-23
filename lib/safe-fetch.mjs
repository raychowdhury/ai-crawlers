import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 2) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (net.isIPv6(ip)) {
    // Only global unicast; reject mapped IPv4, local, multicast and transition ranges.
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const first = parseInt(normalized.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff &&
      !(first === 0x2001 && ((parseInt(normalized.split(':')[1] || '0',16) <= 0x1ff) || normalized.split(':')[1] === 'db8')) &&
      !normalized.startsWith('2002:') && !normalized.startsWith('3fff:');
  }
  return false;
}

export function publicUrl(input) {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Enter a valid public website URL.');
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid URL, for example https://example.com'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http:// and https:// URLs are supported.');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed.');
  if (url.port) throw new Error('Only standard HTTP and HTTPS ports are supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'localhost.localdomain' ||
      (net.isIP(host) && !isPublicIp(host))) throw new Error('Private or non-public network targets are not allowed.');
  return url;
}

export function createSafeFetch({resolve = lookup, request = (url, options, callback) =>
  (url.protocol === 'https:' ? https : http).request(url, options, callback), timeoutMs = 9000,
  maxBytes = 1_500_000} = {}) {
  return async function safeFetch(input, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    const signal = controller.signal;
    async function visit(input, redirects = 0) {
      if (redirects > 5) throw new Error('Too many redirects.');
      const url = publicUrl(input);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = net.isIP(host) ? [{address: host, family: net.isIP(host)}] : await new Promise((ok, fail) => {
        const aborted = () => fail(signal.reason);
        signal.addEventListener('abort', aborted, {once:true});
        Promise.resolve().then(() => resolve(host, {all:true, verbatim:true})).then(ok, fail)
          .finally(() => signal.removeEventListener('abort', aborted));
        if (signal.aborted) aborted();
      });
      if (!addresses.length || addresses.some(a => !isPublicIp(a.address))) throw new Error('Private or non-public network targets are not allowed.');
      signal.throwIfAborted();
      const pinned = addresses[0];
      const result = await new Promise((ok, fail) => {
        const req = request(url, {
          method:'GET', agent:false, signal, family:pinned.family,
          // Preserve URL hostname for Host and TLS verification, pin the connection's DNS result.
          lookup: (_host, opts, callback) => opts?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
          headers:{accept:'text/html,text/plain,application/xhtml+xml,*/*;q=0.8', 'accept-encoding':'identity', ...(options.headers || {})}
        }, res => {
          const status = res.statusCode;
          const location = res.headers.location;
          if ([301,302,303,307,308].includes(status) && location) {
            res.destroy();
            ok({location, url, redirects});
            return;
          }
          let bytes = 0;
          const chunks = [];
          res.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > maxBytes) { const error = new Error('Response exceeds size limit'); fail(error); res.destroy(error); req.destroy(error); }
            else chunks.push(chunk);
          });
          res.on('error', fail);
          res.on('aborted', () => fail(new Error('Response ended prematurely')));
          res.on('end', () => {
            const headers = new Headers();
            for (const [name,value] of Object.entries(res.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            ok({response:new Response([204,205,304].includes(status) ? null : Buffer.concat(chunks), {status,headers}), finalUrl:url.href, redirects});
          });
        });
        req.on('error', fail);
        req.end();
      });
      return result.location ? visit(new URL(result.location, result.url).href, redirects + 1) : result;
    }
    try { return await visit(input); } finally { clearTimeout(timer); }
  };
}
export const safeFetch = createSafeFetch();
