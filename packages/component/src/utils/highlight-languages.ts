/**
 * Highlight.js on-demand loading configuration
 *
 * Only registers commonly used languages, significantly reducing bundle size (from 9.2MB to ~1MB).
 * Covers common RTC Agent code scenarios: TypeScript/JavaScript/Python/Go/JSON/YAML/Bash, etc.
 */
import hljs from 'highlight.js/lib/core';

// ===== Common language registration =====

// Web development
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';

// Backend/systems
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';

// Configuration/markup
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript); // alias
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript); // alias
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml); // alias
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python); // alias
hljs.registerLanguage('go', go);
hljs.registerLanguage('golang', go); // alias
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash); // alias
hljs.registerLanguage('shell', bash); // alias
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml); // alias
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown); // alias
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext); // alias

export default hljs;
