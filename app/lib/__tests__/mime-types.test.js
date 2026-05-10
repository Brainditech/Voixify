import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { mimeForFile, isSupportedExt, SUPPORTED_EXTENSIONS, MIME_BY_EXT } = requireCjs('../mime-types.cjs');

describe('mimeForFile', () => {
    it('returns the correct mime for common audio extensions', () => {
        expect(mimeForFile('song.mp3')).toBe('audio/mpeg');
        expect(mimeForFile('voice.wav')).toBe('audio/wav');
        expect(mimeForFile('clip.m4a')).toBe('audio/mp4');
        expect(mimeForFile('record.webm')).toBe('audio/webm');
        expect(mimeForFile('lossless.flac')).toBe('audio/flac');
    });

    it('returns the correct mime for video extensions', () => {
        expect(mimeForFile('movie.mp4')).toBe('video/mp4');
        expect(mimeForFile('clip.MOV')).toBe('video/quicktime');
        expect(mimeForFile('archive.mkv')).toBe('video/x-matroska');
    });

    it('is case-insensitive on the extension', () => {
        expect(mimeForFile('Track.MP3')).toBe('audio/mpeg');
        expect(mimeForFile('Voice.M4A')).toBe('audio/mp4');
    });

    it('handles full Windows-style paths', () => {
        expect(mimeForFile('C:\\Users\\me\\Music\\song.mp3')).toBe('audio/mpeg');
        expect(mimeForFile('/home/me/song.mp3')).toBe('audio/mpeg');
    });

    it('falls back to octet-stream for unknown extensions', () => {
        expect(mimeForFile('document.docx')).toBe('application/octet-stream');
        expect(mimeForFile('archive.zip')).toBe('application/octet-stream');
        expect(mimeForFile('noextension')).toBe('application/octet-stream');
    });

    it('handles invalid input without throwing', () => {
        expect(mimeForFile('')).toBe('application/octet-stream');
        expect(mimeForFile(null)).toBe('application/octet-stream');
        expect(mimeForFile(undefined)).toBe('application/octet-stream');
    });
});

describe('isSupportedExt', () => {
    it('returns true for every key in MIME_BY_EXT', () => {
        for (const ext of Object.keys(MIME_BY_EXT)) {
            expect(isSupportedExt(`file${ext}`)).toBe(true);
        }
    });

    it('returns false for non-supported extensions', () => {
        expect(isSupportedExt('file.docx')).toBe(false);
        expect(isSupportedExt('file.zip')).toBe(false);
        expect(isSupportedExt('file.txt')).toBe(false);
    });

    it('treats casing as equivalent', () => {
        expect(isSupportedExt('TRACK.MP3')).toBe(true);
        expect(isSupportedExt('VIDEO.MOV')).toBe(true);
    });
});

describe('SUPPORTED_EXTENSIONS', () => {
    it('contains every extension from the map without leading dots', () => {
        expect(SUPPORTED_EXTENSIONS).toContain('mp3');
        expect(SUPPORTED_EXTENSIONS).toContain('mp4');
        expect(SUPPORTED_EXTENSIONS).toContain('webm');
        expect(SUPPORTED_EXTENSIONS).not.toContain('.mp3');
    });

    it('is sorted', () => {
        const sorted = [...SUPPORTED_EXTENSIONS].sort();
        expect(SUPPORTED_EXTENSIONS).toEqual(sorted);
    });
});
