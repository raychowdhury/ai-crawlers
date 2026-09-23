// Per-process limits. Do not trust client-supplied forwarding headers.
export function createAuditGate({maxActive=3, perClient=10, globalLimit=30, windowMs=60000, now=Date.now} = {}) {
  const clients = new Map();
  let active=0, total=0, resetAt=0;
  return function acquire(key) {
    const time=now();
    if (time >= resetAt) { clients.clear(); total=0; resetAt=time+windowMs; }
    if (active >= maxActive || total >= globalLimit || (clients.get(key)||0) >= perClient) return null;
    total++; clients.set(key,(clients.get(key)||0)+1); active++;
    let released=false;
    return () => { if (!released) { active--; released=true; } };
  };
}
