import { describe, it, expect } from 'vitest';
import { getFileType, getFileIcon } from '../file-handler';

describe('getFileType', () => {
    it('identifies PDF files', () => {
        expect(getFileType('document.pdf')).toBe('pdf');
        expect(getFileType('DOCUMENT.PDF')).toBe('pdf');
        expect(getFileType('path/to/file.pdf')).toBe('pdf');
    });

    it('identifies DOCX files', () => {
        expect(getFileType('document.docx')).toBe('docx');
        expect(getFileType('DOCUMENT.DOCX')).toBe('docx');
    });

    it('identifies DOC files', () => {
        expect(getFileType('document.doc')).toBe('doc');
        expect(getFileType('DOCUMENT.DOC')).toBe('doc');
    });

    it('identifies ZIP files', () => {
        expect(getFileType('archive.zip')).toBe('zip');
        expect(getFileType('ARCHIVE.ZIP')).toBe('zip');
    });

    it('returns null for unsupported extensions', () => {
        expect(getFileType('file.txt')).toBeNull();
        expect(getFileType('file.png')).toBeNull();
        expect(getFileType('file')).toBeNull();
        expect(getFileType('')).toBeNull();
    });
});

describe('getFileIcon', () => {
    it('returns SVG for PDF', () => {
        const icon = getFileIcon('test.pdf');
        expect(icon).toContain('<img');
        expect(icon).toContain('pdf.svg');
    });

    it('returns SVG for DOCX', () => {
        const icon = getFileIcon('test.docx');
        expect(icon).toContain('<img');
        expect(icon).toContain('docx.svg');
    });

    it('returns SVG for DOC', () => {
        const icon = getFileIcon('test.doc');
        expect(icon).toContain('<img');
        expect(icon).toContain('docx.svg');
    });

    it('returns generic icon for unknown types', () => {
        const icon = getFileIcon('test.txt');
        expect(icon).toContain('<svg');
        expect(icon).toContain('viewBox');
    });
});
