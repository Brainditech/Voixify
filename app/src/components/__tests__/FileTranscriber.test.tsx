import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installMockVoixifyApi } from '../../__tests__/setup';
import { useVoixifyStore } from '../../stores/voixifyStore';
import FileTranscriber from '../FileTranscriber';

describe('FileTranscriber', () => {
    beforeEach(() => {
        // Reset store with a known language so the UI renders deterministically.
        useVoixifyStore.setState({ lang: 'fr' });
    });

    it('renders the idle pickzone on first paint', () => {
        installMockVoixifyApi();
        render(<FileTranscriber />);
        expect(screen.getByRole('button', { name: /Choisir un fichier/i })).toBeInTheDocument();
        expect(screen.getByText(/Formats acceptés/)).toBeInTheDocument();
    });

    it('stays idle when the user cancels the file picker', async () => {
        const api = installMockVoixifyApi({
            pickTranscriptionFile: vi.fn().mockResolvedValue(null),
        });
        render(<FileTranscriber />);
        await userEvent.click(screen.getByRole('button', { name: /Choisir un fichier/i }));
        expect(api.pickTranscriptionFile).toHaveBeenCalledTimes(1);
        // Still idle: pickzone hint visible, no transcript.
        expect(screen.getByText(/Formats acceptés/)).toBeInTheDocument();
        expect(api.transcribeFile).not.toHaveBeenCalled();
    });

    it('runs the full pick → transcribe → display flow', async () => {
        const api = installMockVoixifyApi({
            pickTranscriptionFile: vi.fn().mockResolvedValue({
                path: 'C:/audio/song.mp3', name: 'song.mp3', sizeBytes: 4_000_000,
            }),
            transcribeFile: vi.fn().mockResolvedValue({
                success: true, transcript: 'Voici la transcription du fichier.',
                durationMs: 1850, fileName: 'song.mp3', sizeBytes: 4_000_000,
            }),
        });
        render(<FileTranscriber />);

        await userEvent.click(screen.getByRole('button', { name: /Choisir un fichier/i }));

        await waitFor(() => {
            expect(api.transcribeFile).toHaveBeenCalledWith({
                filePath: 'C:/audio/song.mp3', language: 'fr',
            });
        });

        // Done state: textarea pre-filled
        const textarea = await screen.findByRole('textbox', { name: /Transcription/i });
        expect((textarea as HTMLTextAreaElement).value).toBe('Voici la transcription du fichier.');
        expect(screen.getByText(/song\.mp3/)).toBeInTheDocument();
    });

    it('shows an error when transcribeFile reports failure and offers retry', async () => {
        const api = installMockVoixifyApi({
            pickTranscriptionFile: vi.fn().mockResolvedValue({
                path: 'C:/clip.wav', name: 'clip.wav', sizeBytes: 1_000_000,
            }),
            transcribeFile: vi.fn().mockResolvedValue({ success: false, error: 'Whisper down' }),
        });
        render(<FileTranscriber />);

        await userEvent.click(screen.getByRole('button', { name: /Choisir un fichier/i }));

        await screen.findByText(/Whisper down/);
        expect(screen.getByRole('button', { name: /Réessayer/i })).toBeInTheDocument();

        // Retry: this time succeed
        api.transcribeFile.mockResolvedValueOnce({
            success: true, transcript: 'second try', durationMs: 100, fileName: 'clip.wav', sizeBytes: 1_000_000,
        });
        await userEvent.click(screen.getByRole('button', { name: /Réessayer/i }));
        const ta = await screen.findByRole('textbox', { name: /Transcription/i });
        expect((ta as HTMLTextAreaElement).value).toBe('second try');
    });

    it('saves the EDITED textarea content (not the original transcript) as .txt', async () => {
        const api = installMockVoixifyApi({
            pickTranscriptionFile: vi.fn().mockResolvedValue({
                path: '/voice.m4a', name: 'voice.m4a', sizeBytes: 500_000,
            }),
            transcribeFile: vi.fn().mockResolvedValue({
                success: true, transcript: 'original text',
                durationMs: 100, fileName: 'voice.m4a', sizeBytes: 500_000,
            }),
            saveTranscription: vi.fn().mockResolvedValue({ success: true, path: '/tmp/out.txt' }),
        });
        render(<FileTranscriber />);

        await userEvent.click(screen.getByRole('button', { name: /Choisir un fichier/i }));
        const ta = await screen.findByRole('textbox', { name: /Transcription/i });

        // User edits the transcript before saving
        fireEvent.change(ta, { target: { value: 'edited content' } });

        await userEvent.click(screen.getByRole('button', { name: /Sauver \.txt/i }));

        expect(api.saveTranscription).toHaveBeenCalledWith({
            content: 'edited content',
            format: 'txt',
            suggestedName: 'voice',
        });
    });

    it('wraps the content in a markdown header when saving as .md', async () => {
        const api = installMockVoixifyApi({
            pickTranscriptionFile: vi.fn().mockResolvedValue({
                path: '/notes.mp3', name: 'notes.mp3', sizeBytes: 1000,
            }),
            transcribeFile: vi.fn().mockResolvedValue({
                success: true, transcript: 'note body',
                durationMs: 100, fileName: 'notes.mp3', sizeBytes: 1000,
            }),
            saveTranscription: vi.fn().mockResolvedValue({ success: true, path: '/tmp/out.md' }),
        });
        render(<FileTranscriber />);

        await userEvent.click(screen.getByRole('button', { name: /Choisir un fichier/i }));
        await screen.findByRole('textbox', { name: /Transcription/i });
        await userEvent.click(screen.getByRole('button', { name: /Sauver \.md/i }));

        const call = api.saveTranscription.mock.calls[0][0];
        expect(call.format).toBe('md');
        expect(call.content).toContain('# Transcription — notes.mp3');
        expect(call.content).toContain('> Source : notes.mp3');
        expect(call.content).toContain('note body');
    });

    it('copies the transcript via voixify.copyToClipboard', async () => {
        const api = installMockVoixifyApi({
            pickTranscriptionFile: vi.fn().mockResolvedValue({
                path: '/x.mp3', name: 'x.mp3', sizeBytes: 1,
            }),
            transcribeFile: vi.fn().mockResolvedValue({
                success: true, transcript: 'to copy',
                durationMs: 1, fileName: 'x.mp3', sizeBytes: 1,
            }),
        });
        render(<FileTranscriber />);
        await userEvent.click(screen.getByRole('button', { name: /Choisir un fichier/i }));
        await screen.findByRole('textbox', { name: /Transcription/i });

        await userEvent.click(screen.getByRole('button', { name: /Copier/i }));
        expect(api.copyToClipboard).toHaveBeenCalledWith('to copy');
    });

    it('returns to idle when "Nouvelle transcription" is clicked', async () => {
        installMockVoixifyApi({
            pickTranscriptionFile: vi.fn().mockResolvedValue({
                path: '/x.mp3', name: 'x.mp3', sizeBytes: 1,
            }),
            transcribeFile: vi.fn().mockResolvedValue({
                success: true, transcript: 'something',
                durationMs: 1, fileName: 'x.mp3', sizeBytes: 1,
            }),
        });
        render(<FileTranscriber />);
        await userEvent.click(screen.getByRole('button', { name: /Choisir un fichier/i }));
        await screen.findByRole('textbox', { name: /Transcription/i });

        await userEvent.click(screen.getByRole('button', { name: /Nouvelle transcription/i }));
        expect(screen.queryByRole('textbox', { name: /Transcription/i })).not.toBeInTheDocument();
        expect(screen.getByText(/Formats acceptés/)).toBeInTheDocument();
    });
});
