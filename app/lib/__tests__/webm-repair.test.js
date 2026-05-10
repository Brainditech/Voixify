import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// fixWebmBuffer ships as a .cjs because electron.cjs (CommonJS) requires it at
// runtime. createRequire bridges into ESM tests cleanly.
const requireCjs = createRequire(import.meta.url);
const { fixWebmBuffer } = requireCjs('../webm-repair.cjs');

const MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

describe('fixWebmBuffer', () => {
    it('returns the same buffer when EBML magic is at offset 0', () => {
        const payload = Buffer.from([0x42, 0x86, 0x81, 0x01]);
        const buf = Buffer.concat([MAGIC, payload]);
        const out = fixWebmBuffer(buf);
        expect(out).toEqual(buf);
    });

    it('strips leading garbage when EBML magic is past offset 0', () => {
        const garbage = Buffer.alloc(1838, 0xaa); // realistic Chromium offset
        const payload = Buffer.from([0x42, 0x86, 0x81, 0x01]);
        const buf = Buffer.concat([garbage, MAGIC, payload]);
        const out = fixWebmBuffer(buf);
        expect(out).not.toBeNull();
        expect(out.length).toBe(MAGIC.length + payload.length);
        expect(out.slice(0, 4).equals(MAGIC)).toBe(true);
    });

    it('returns null when no EBML magic is present', () => {
        const buf = Buffer.alloc(2048, 0xff);
        expect(fixWebmBuffer(buf)).toBeNull();
    });

    it('returns null for buffers shorter than the magic itself', () => {
        expect(fixWebmBuffer(Buffer.from([0x1a, 0x45, 0xdf]))).toBeNull();
        expect(fixWebmBuffer(Buffer.alloc(0))).toBeNull();
    });

    it('returns null for nullish input', () => {
        expect(fixWebmBuffer(null)).toBeNull();
        expect(fixWebmBuffer(undefined)).toBeNull();
    });

    it('returns null when magic appears past the 64KB scan window', () => {
        const giant = Buffer.alloc(70_000, 0x00);
        // Place magic at offset 66000 (past the 65536 window)
        MAGIC.copy(giant, 66_000);
        expect(fixWebmBuffer(giant)).toBeNull();
    });

    it('finds magic at the very edge of the scan window', () => {
        const buf = Buffer.alloc(65540, 0x00);
        const offset = 65535; // last position the scan can reach
        MAGIC.copy(buf, offset);
        const out = fixWebmBuffer(buf);
        expect(out).not.toBeNull();
        expect(out.length).toBe(buf.length - offset);
    });
});
