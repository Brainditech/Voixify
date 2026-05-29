// Mirror of app/lib/url-guard.cjs — kept as a separate file because the backend
// is its own npm package and cannot import across the app/ boundary.
//
// Guards the user-supplied Ollama URL before it is used in an outbound fetch.
// We require an http(s) scheme (closing protocol-based SSRF such as file:// or
// gopher://) but do not restrict the host: pointing Ollama at a LAN box is a
// legitimate user configuration.

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
    if (!parsed.hostname) return false;
    return true;
}

module.exports = { isAllowedServiceUrl };
