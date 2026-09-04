import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './scenario-loader.js';

describe('parseFrontmatter', () => {
    it('should parse title from frontmatter', () => {
        const content = `---
title: "Test Title"
---
Body content here.`;
        const result = parseFrontmatter(content);
        expect(result.title).toBe('Test Title');
        expect(result.body).toBe('Body content here.');
    });

    it('should parse tags array', () => {
        const content = `---
title: "Tagged"
tags: ["tag1", "tag2", "tag3"]
---

Body`;
        const result = parseFrontmatter(content);
        expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should return body when no frontmatter', () => {
        const content = 'Just plain body content.';
        const result = parseFrontmatter(content);
        expect(result.title).toBeUndefined();
        expect(result.body).toBe('Just plain body content.');
    });

    it('should handle empty frontmatter as plain body', () => {
        // When frontmatter is truly empty (no fields), the regex doesn't match
        // and the entire content is returned as body. This is expected behavior.
        const content = `---
---
Body only.`;
        const result = parseFrontmatter(content);
        expect(result.title).toBeUndefined();
        expect(result.body).toContain('Body only.');
    });

    it('should parse multiple fields', () => {
        const content = `---
title: "Full Example"
id: "scenario-1"
name: "My Scenario"
description: "A test scenario"
author: "Test Author"
createdAt: "2024-01-01T00:00:00Z"
---
The body.`;
        const result = parseFrontmatter(content);
        expect(result.title).toBe('Full Example');
        expect(result.id).toBe('scenario-1');
        expect(result.name).toBe('My Scenario');
        expect(result.description).toBe('A test scenario');
        expect(result.author).toBe('Test Author');
        expect(result.createdAt).toBe('2024-01-01T00:00:00Z');
        expect(result.body).toBe('The body.');
    });

    it('should handle \\r\\n line endings', () => {
        const content = '---\r\ntitle: "Windows"\r\n---\r\nBody';
        const result = parseFrontmatter(content);
        expect(result.title).toBe('Windows');
        expect(result.body).toBe('Body');
    });

    it('should handle unquoted values', () => {
        const content = `---
title: Unquoted Title
---

Body`;
        const result = parseFrontmatter(content);
        expect(result.title).toBe('Unquoted Title');
    });
});
