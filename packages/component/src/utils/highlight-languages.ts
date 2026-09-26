/**
 * Highlight.js 按需加载配置
 *
 * 只注册常用语言，大幅减小包体积（从 9.2MB 降至 ~1MB）。
 * 覆盖 RTC Agent 常见的代码场景：TypeScript/JavaScript/Python/Go/JSON/YAML/Bash 等。
 */
import hljs from 'highlight.js/lib/core';

// ===== 常用语言注册 =====

// Web 开发
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';

// 后端/系统
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';

// 配置/标记
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

// 注册语言
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript); // 别名
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript); // 别名
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml); // 别名
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python); // 别名
hljs.registerLanguage('go', go);
hljs.registerLanguage('golang', go); // 别名
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash); // 别名
hljs.registerLanguage('shell', bash); // 别名
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml); // 别名
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown); // 别名
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext); // 别名

export default hljs;
