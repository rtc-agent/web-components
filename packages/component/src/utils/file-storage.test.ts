import { describe, it, expect } from 'vitest';
import { getFileExtension, generateFilename } from './file-storage.js';

describe('file-storage utilities', () => {
  describe('getFileExtension', () => {
    it('should extract extension from filename', () => {
      expect(getFileExtension('document.pdf')).toBe('pdf');
      expect(getFileExtension('image.JPG')).toBe('jpg');
      expect(getFileExtension('file.name.with.dots.txt')).toBe('txt');
    });

    it('should return bin for files without extension', () => {
      expect(getFileExtension('noextension')).toBe('bin');
      expect(getFileExtension('file.')).toBe('bin');
    });

    it('should handle empty string', () => {
      expect(getFileExtension('')).toBe('bin');
    });
  });

  describe('generateFilename', () => {
    it('should generate filename from md5 and ext', () => {
      const md5 = 'd41d8cd98f00b204e9800998ecf8427e';
      expect(generateFilename(md5, 'txt')).toBe('d41d8cd98f00b204e9800998ecf8427e.txt');
      expect(generateFilename(md5, 'pdf')).toBe('d41d8cd98f00b204e9800998ecf8427e.pdf');
    });
  });
});
