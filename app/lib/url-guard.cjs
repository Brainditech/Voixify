// Validates user-supplied service URLs (Whisper / Ollama) before they are used
// to build an outbound HTTP request from a privileged process.
//
// The threat we close here is protocol-based SSRF: a value like
// `file:///etc/passwd`, `gopher://…`, or `data:…` reaching an HTTP client could
// be coerced into reading local files or speaking to unexpected services. We
// intentionally do NOT restrict the host — pointing Whisper/Ollama at a LAN box
// is a legitimate user configuration — but we hard-require an http(s) scheme so
// only real HTTP endpoints are ever contacted.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isAllowedServiceUrl(urlStr) {
    if (typeof urlStr !== 'string' || urlStr.trim() === '') return false;
    let parsed;
    try {
        parsed = new URL(urlStr);
    } catch {
        return false;
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
    // A URL like "http:///path" parses with an empty hostname — reject it.
    if (!parsed.hostname) return false;
    return true;
}

module.exports = { isAllowedServiceUrl };
