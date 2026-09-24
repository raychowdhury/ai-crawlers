export function securityHeaders(res){
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('x-frame-options','DENY');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('referrer-policy','no-referrer');
  // Browsers honor HSTS only over HTTPS. No subdomain or preload commitment.
  res.setHeader('strict-transport-security','max-age=31536000');
  res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');
}
