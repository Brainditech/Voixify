import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { isAllowedServiceUrl } = requireCjs('../url-guard.cjs');

describe('isAllowedServiceUrl', () => {
    it('accepts http and https URLs with a host', () => {
        expect(isAllowedServiceUrl('http://127.0.0.1:9990')).toBe(true);
        expect(isAllowedServiceUrl('http://localhost:11434')).toBe(true);
        expect(isAllowedServiceUrl('https://api.deepgram.com')).toBe(true);
        expect(isAllowedServiceUrl('http://192.168.1.50:9990/transcribe')).toBe(true);
    });

    it('rejects non-http(s) protocols (SSRF vectors)', () => {
        expect(isAllowedServiceUrl('file:///etc/passwd')).toBe(false);
        expect(isAllowedServiceUrl('gopher://127.0.0.1:6379/_INFO')).toBe(false);
        expect(isAllowedServiceUrl('data:text/plain,hello')).toBe(false);
        expect(isAllowedServiceUrl('ftp://example.com/x')).toBe(false);
        expect(isAllowedServiceUrl('ws://127.0.0.1:9990')).toBe(false);
    });

    it('rejects malformed URLs that fail to parse', () => {
        expect(isAllowedServiceUrl('not a url')).toBe(false);
        expect(isAllowedServiceUrl('://missing-scheme')).toBe(false);
        expect(isAllowedServiceUrl('http://')).toBe(false);
    });

    it('rejects empty and non-string input without throwing', () => {
        expect(isAllowedServiceUrl('')).toBe(false);
        expect(isAllowedServiceUrl('   ')).toBe(false);
        expect(isAllowedServiceUrl(null)).toBe(false);
        expect(isAllowedServiceUrl(undefined)).toBe(false);
        expect(isAllowedServiceUrl(123)).toBe(false);
        expect(isAllowedServiceUrl({})).toBe(false);
    });
});
