import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ScriptTimeoutError,
  ScriptCompileError,
  createSandbox,
  transformTypeScript,
  parseScriptContent,
  generateScriptContent,
  _executeCode,
  executeScriptCode,
  saveScript,
  loadAndExecuteScript,
  type ScriptSandbox,
  type ConsoleOutput,
  type RtcAgentAPI,
} from './script-engine.js';
import { virtualFS } from './virtual-fs.js';
import { getDatabase, closeDatabase, DB_NAME_PREFIX } from './database.js';

const TEST_DB = `${DB_NAME_PREFIX}test-script-engine`;

// ============================================================
// Helpers
// ============================================================

function createMockRtcAgent(): RtcAgentAPI {
  return {
    callFunction: async (_path, _params) => ({ ok: true }),
    readFile: async (_path) => 'file-content',
    writeFile: async (_path, _content) => {},
    listDir: async (_path) => ['file1.ts', 'file2.ts'],
  };
}

function createOutput(): ConsoleOutput {
  return { logs: [], warns: [], errors: [] };
}

// ============================================================
// Custom Error Classes
// ============================================================

describe('ScriptTimeoutError', () => {
  it('should have correct name and message', () => {
    const err = new ScriptTimeoutError(5000);
    expect(err.name).toBe('ScriptTimeoutError');
    expect(err.message).toContain('5000');
    expect(err.isScriptTimeout).toBe(true);
  });

  it('should be an instance of Error', () => {
    const err = new ScriptTimeoutError(1000);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ScriptCompileError', () => {
  it('should have correct name and message', () => {
    const err = new ScriptCompileError('transform failed', 'myScript');
    expect(err.name).toBe('ScriptCompileError');
    expect(err.message).toContain('transform failed');
    expect(err.scriptName).toBe('myScript');
    expect(err.isScriptCompileError).toBe(true);
  });

  it('should work without script name', () => {
    const err = new ScriptCompileError('some error');
    expect(err.scriptName).toBeUndefined();
  });

  it('should be an instance of Error', () => {
    const err = new ScriptCompileError('error');
    expect(err).toBeInstanceOf(Error);
  });
});

// ============================================================
// createSandbox
// ============================================================

describe('createSandbox', () => {
  let sandbox: ScriptSandbox;

  beforeEach(() => {
    sandbox = createSandbox(createMockRtcAgent(), { key: 'value' }, createOutput(), 'TestScript');
  });

  it('should create a sandbox with rtcAgent and params', () => {
    expect(sandbox.rtcAgent).toBeDefined();
    expect(sandbox.params).toEqual({ key: 'value' });
  });

  it('should have standard language constructors', () => {
    expect(sandbox.Promise).toBe(Promise);
    expect(sandbox.Date).toBe(Date);
    expect(sandbox.Math).toBe(Math);
    expect(sandbox.JSON).toBe(JSON);
    expect(sandbox.Array).toBe(Array);
    expect(sandbox.Object).toBe(Object);
    expect(sandbox.String).toBe(String);
    expect(sandbox.Number).toBe(Number);
    expect(sandbox.Boolean).toBe(Boolean);
    expect(sandbox.Error).toBe(Error);
  });

  it('should have data structure constructors', () => {
    expect(sandbox.Map).toBe(Map);
    expect(sandbox.Set).toBe(Set);
    expect(sandbox.WeakMap).toBe(WeakMap);
    expect(sandbox.WeakSet).toBe(WeakSet);
    expect(sandbox.RegExp).toBe(RegExp);
    expect(sandbox.Symbol).toBe(Symbol);
    expect(sandbox.BigInt).toBe(BigInt);
  });

  it('should have error subclasses', () => {
    expect(sandbox.TypeError).toBe(TypeError);
    expect(sandbox.RangeError).toBe(RangeError);
    expect(sandbox.ReferenceError).toBe(ReferenceError);
    expect(sandbox.SyntaxError).toBe(SyntaxError);
    expect(sandbox.URIError).toBe(URIError);
    expect(sandbox.AggregateError).toBe(AggregateError);
  });

  it('should have parsing and encoding functions', () => {
    expect(sandbox.parseInt).toBe(parseInt);
    expect(sandbox.parseFloat).toBe(parseFloat);
    expect(sandbox.isNaN).toBe(isNaN);
    expect(sandbox.isFinite).toBe(isFinite);
    expect(sandbox.encodeURIComponent).toBe(encodeURIComponent);
    expect(sandbox.decodeURIComponent).toBe(decodeURIComponent);
    expect(sandbox.encodeURI).toBe(encodeURI);
    expect(sandbox.decodeURI).toBe(decodeURI);
    expect(sandbox.atob).toBe(atob);
    expect(sandbox.btoa).toBe(btoa);
  });

  it('should have utility functions', () => {
    expect(sandbox.structuredClone).toBe(structuredClone);
  });

  it('should have special values', () => {
    expect(sandbox.NaN).toBe(NaN);
    expect(sandbox.Infinity).toBe(Infinity);
    expect(sandbox.undefined).toBe(undefined);
  });

  it('should have URL constructors', () => {
    expect(sandbox.URL).toBe(URL);
    expect(sandbox.URLSearchParams).toBe(URLSearchParams);
  });

  describe('console capture', () => {
    it('should capture log output to ConsoleOutput', () => {
      const output = createOutput();
      const sb = createSandbox(createMockRtcAgent(), {}, output, 'MyScript');
      sb.console.log('hello', 'world');
      expect(output.logs).toEqual(['hello world']);
    });

    it('should capture warn output to ConsoleOutput', () => {
      const output = createOutput();
      const sb = createSandbox(createMockRtcAgent(), {}, output);
      sb.console.warn('warning message');
      expect(output.warns).toEqual(['warning message']);
    });

    it('should capture error output to ConsoleOutput', () => {
      const output = createOutput();
      const sb = createSandbox(createMockRtcAgent(), {}, output);
      sb.console.error('error message');
      expect(output.errors).toEqual(['error message']);
    });

    it('should JSON-stringify object arguments', () => {
      const output = createOutput();
      const sb = createSandbox(createMockRtcAgent(), {}, output);
      sb.console.log({ a: 1 }, [1, 2]);
      expect(output.logs.length).toBe(1);
      expect(output.logs[0]).toContain('"a"');
      expect(output.logs[0]).toContain('1');
    });

    it('should handle non-object arguments as String()', () => {
      const output = createOutput();
      const sb = createSandbox(createMockRtcAgent(), {}, output);
      sb.console.log(42, true, null);
      expect(output.logs).toEqual(['42 true null']);
    });

    it('should handle circular objects gracefully', () => {
      const output = createOutput();
      const sb = createSandbox(createMockRtcAgent(), {}, output);
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      // Should not throw; falls back to String(arg)
      sb.console.log(circular);
      expect(output.logs.length).toBe(1);
    });

    it('should not push to output when output is not provided', () => {
      const sb = createSandbox(createMockRtcAgent(), {});
      // Should not throw
      sb.console.log('test');
      sb.console.warn('test');
      sb.console.error('test');
    });
  });
});

// ============================================================
// transformTypeScript
// ============================================================

describe('transformTypeScript', () => {
  it('should strip TypeScript type annotations', () => {
    const code = `const x: number = 42;`;
    const result = transformTypeScript(code);
    expect(result).not.toContain(': number');
    expect(result).toContain('42');
  });

  it('should strip interface declarations', () => {
    const code = `
      interface Foo {
        bar: string;
      }
      const x = 1;
    `;
    const result = transformTypeScript(code);
    expect(result).not.toContain('interface');
    expect(result).toContain('const x = 1');
  });

  it('should strip type aliases', () => {
    const code = `
      type MyType = string | number;
      const x: MyType = "hello";
    `;
    const result = transformTypeScript(code);
    expect(result).not.toContain('type MyType');
  });

  it('should strip generic type parameters', () => {
    const code = `function identity<T>(x: T): T { return x; }`;
    const result = transformTypeScript(code);
    expect(result).not.toContain('<T>');
    expect(result).toContain('return x');
  });

  it('should use script name in filename when provided', () => {
    // Should not throw
    const result = transformTypeScript('const x = 1;', 'myScript');
    expect(result).toContain('const x = 1');
  });

  it('should throw ScriptCompileError for invalid syntax', () => {
    expect(() => {
      transformTypeScript('const x = ;');
    }).toThrow(ScriptCompileError);
  });

  describe('sandbox security', () => {
    it('should block access to localStorage', () => {
      expect(() => {
        transformTypeScript('localStorage.getItem("key")');
      }).toThrow(/localStorage/);
    });

    it('should block access to fetch', () => {
      expect(() => {
        transformTypeScript('fetch("https://example.com")');
      }).toThrow(/fetch/);
    });

    it('should block access to document', () => {
      expect(() => {
        transformTypeScript('document.querySelector("div")');
      }).toThrow(/document/);
    });

    it('should block access to window', () => {
      expect(() => {
        transformTypeScript('window.location.href');
      }).toThrow(/window/);
    });

    it('should block access to eval', () => {
      expect(() => {
        transformTypeScript('eval("code")');
      }).toThrow(/eval/);
    });

    it('should block access to Function constructor', () => {
      expect(() => {
        transformTypeScript('Function("return 1")');
      }).toThrow(/Function/);
    });

    it('should block access to globalThis', () => {
      expect(() => {
        transformTypeScript('globalThis.document');
      }).toThrow(/globalThis/);
    });

    it('should block access to setTimeout', () => {
      expect(() => {
        transformTypeScript('setTimeout(() => {}, 1000)');
      }).toThrow(/setTimeout/);
    });

    it('should block access to setInterval', () => {
      expect(() => {
        transformTypeScript('setInterval(() => {}, 1000)');
      }).toThrow(/setInterval/);
    });

    it('should block access to WebSocket', () => {
      expect(() => {
        transformTypeScript('new WebSocket("ws://example.com")');
      }).toThrow(/WebSocket/);
    });

    it('should block access to XMLHttpRequest', () => {
      expect(() => {
        transformTypeScript('new XMLHttpRequest()');
      }).toThrow(/XMLHttpRequest/);
    });

    it('should block access to Worker', () => {
      expect(() => {
        transformTypeScript('new Worker("worker.js")');
      }).toThrow(/Worker/);
    });

    it('should block dynamic import()', () => {
      expect(() => {
        transformTypeScript('import("module")');
      }).toThrow(/Dynamic import/);
    });

    it('should block .constructor property access', () => {
      expect(() => {
        transformTypeScript('const x = {}.constructor');
      }).toThrow(/constructor/);
    });

    it('should block __proto__ property access', () => {
      expect(() => {
        transformTypeScript('const x = {}.__proto__');
      }).toThrow(/__proto__/);
    });

    it('should block indexed bracket access to constructor', () => {
      expect(() => {
        transformTypeScript('const x = {}["constructor"]');
      }).toThrow(/constructor/);
    });

    it('should block while loops', () => {
      expect(() => {
        transformTypeScript('while(true) { break; }');
      }).toThrow(/while/);
    });

    it('should block do-while loops', () => {
      expect(() => {
        transformTypeScript('do { break; } while(true)');
      }).toThrow(/do\.\.\.while/);
    });

    it('should block for(;;) infinite loops', () => {
      expect(() => {
        transformTypeScript('for(;;) { break; }');
      }).toThrow(/for\(\;\;\)/);
    });

    it('should allow bounded for loops', () => {
      const code = 'for(let i = 0; i < 10; i++) { console.log(i); }';
      const result = transformTypeScript(code);
      expect(result).toContain('for');
    });

    it('should allow for...of loops', () => {
      const code = 'for(const x of [1,2,3]) { console.log(x); }';
      const result = transformTypeScript(code);
      expect(result).toContain('for');
    });

    it('should allow for...in loops', () => {
      const code = 'for(const k in {a:1}) { console.log(k); }';
      const result = transformTypeScript(code);
      expect(result).toContain('for');
    });

    it('should allow locally-bound identifiers that shadow blocked globals', () => {
      // Local variable named 'fetch' should be allowed
      const code = 'const fetch = (x: string) => x; fetch("hello")';
      const result = transformTypeScript(code);
      expect(result).toContain('fetch');
    });

    it('should skip TypeScript type positions', () => {
      // 'fetch' as a type name should be allowed
      const code = `
        type fetch = string;
        const x: fetch = "hello";
      `;
      const result = transformTypeScript(code);
      expect(result).toBeTruthy();
    });
  });
});

// ============================================================
// parseScriptContent
// ============================================================

describe('parseScriptContent', () => {
  it('should parse frontmatter with simple key-value pairs', () => {
    const content = `---
name: "myScript"
description: "A test script"
---

\`\`\`typescript
const x = 42;
\`\`\`
`;
    const result = parseScriptContent(content);
    expect(result.metadata.name).toBe('myScript');
    expect(result.metadata.description).toBe('A test script');
    expect(result.code).toBe('const x = 42;');
  });

  it('should strip quotes from metadata values', () => {
    const content = `---
name: "quoted"
---

\`\`\`javascript
const x = 1;
\`\`\`
`;
    const result = parseScriptContent(content);
    expect(result.metadata.name).toBe('quoted');
  });

  it('should handle unquoted metadata values', () => {
    const content = `---
name: unquoted
---

\`\`\`ts
const x = 1;
\`\`\`
`;
    const result = parseScriptContent(content);
    expect(result.metadata.name).toBe('unquoted');
  });

  it('should skip YAML comments', () => {
    const content = `---
# This is a comment
name: "test"
---

\`\`\`ts
const x = 1;
\`\`\`
`;
    const result = parseScriptContent(content);
    expect(result.metadata.name).toBe('test');
    expect(Object.keys(result.metadata)).not.toContain('# This is a comment');
  });

  it('should skip empty YAML lines', () => {
    const content = `---
name: "test"

description: "test"
---

\`\`\`ts
const x = 1;
\`\`\`
`;
    const result = parseScriptContent(content);
    expect(result.metadata.name).toBe('test');
    expect(result.metadata.description).toBe('test');
  });

  it('should support multiple code blocks by concatenation', () => {
    const content = `---
name: "multi"
---

\`\`\`typescript
const a = 1;
\`\`\`

Some text between blocks.

\`\`\`typescript
const b = 2;
\`\`\`
`;
    const result = parseScriptContent(content);
    expect(result.code).toContain('const a = 1;');
    expect(result.code).toContain('const b = 2;');
  });

  it('should use body directly when no code blocks found', () => {
    const content = `---
name: "pure"
---

const x = 42;
const y = x + 1;
`;
    const result = parseScriptContent(content);
    expect(result.code).toBe('const x = 42;\nconst y = x + 1;');
  });

  it('should throw when frontmatter is missing', () => {
    expect(() => {
      parseScriptContent('const x = 1;');
    }).toThrow(/missing frontmatter/);
  });

  it('should support code blocks with no language tag', () => {
    const content = `---
name: "test"
---

\`\`\`
const x = 1;
\`\`\`
`;
    const result = parseScriptContent(content);
    expect(result.code).toBe('const x = 1;');
  });

  it('should handle Windows-style line endings', () => {
    const content = `---\r\nname: "test"\r\n---\r\n\r\n\`\`\`ts\r\nconst x = 1;\r\n\`\`\``;
    const result = parseScriptContent(content);
    expect(result.metadata.name).toBe('test');
    expect(result.code).toBe('const x = 1;');
  });
});

// ============================================================
// generateScriptContent
// ============================================================

describe('generateScriptContent', () => {
  it('should generate valid frontmatter + code block', () => {
    const content = generateScriptContent('test', 'const x = 42;');
    expect(content).toContain('---');
    expect(content).toContain('name: "test"');
    expect(content).toContain('```typescript');
    expect(content).toContain('const x = 42;');
    expect(content).toContain('createdAt:');
  });

  it('should include description when provided', () => {
    const content = generateScriptContent('test', 'const x = 42;', 'A description');
    expect(content).toContain('description: "A description"');
  });

  it('should not include description when not provided', () => {
    const content = generateScriptContent('test', 'const x = 42;');
    expect(content).not.toContain('description:');
  });

  it('should be round-trippable with parseScriptContent', () => {
    const original = generateScriptContent('roundtrip', 'const x = 42;', 'Test');
    const parsed = parseScriptContent(original);
    expect(parsed.metadata.name).toBe('roundtrip');
    expect(parsed.metadata.description).toBe('Test');
    expect(parsed.code).toBe('const x = 42;');
  });
});

// ============================================================
// _executeCode
// ============================================================

describe('_executeCode', () => {
  let sandbox: ScriptSandbox;

  beforeEach(() => {
    sandbox = createSandbox(createMockRtcAgent(), { name: 'test' }, createOutput());
  });

  it('should execute simple JavaScript code', async () => {
    const result = await _executeCode('return 42;', sandbox, 5000);
    expect(result).toBe(42);
  });

  it('should execute async code with await', async () => {
    const code = `
      const p = Promise.resolve(100);
      return await p;
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe(100);
  });

  it('should have access to sandbox params', async () => {
    const code = `return params.name;`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe('test');
  });

  it('should have access to rtcAgent API', async () => {
    const code = `return await rtcAgent.callFunction('test', {});`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual({ ok: true });
  });

  it('should capture console output in sandbox', async () => {
    const output = createOutput();
    const sb = createSandbox(createMockRtcAgent(), {}, output);
    await _executeCode(`console.log("hello from script");`, sb, 5000);
    expect(output.logs).toEqual(['hello from script']);
  });

  it('should have access to standard library (Math)', async () => {
    const code = `return Math.max(1, 2, 3);`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe(3);
  });

  it('should have access to standard library (JSON)', async () => {
    const code = `return JSON.parse('{"a":1}');`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual({ a: 1 });
  });

  it('should have access to data structures (Map, Set)', async () => {
    const code = `
      const m = new Map([['a', 1]]);
      const s = new Set([1, 2, 3]);
      return { mapSize: m.size, setSize: s.size };
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual({ mapSize: 1, setSize: 3 });
  });

  it('should have access to parseInt/parseFloat', async () => {
    const code = `return parseInt("42") + parseFloat("3.14");`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBeCloseTo(45.14);
  });

  it('should have access to URL/URLSearchParams', async () => {
    const code = `
      const url = new URL("https://example.com/path?q=test");
      const params = new URLSearchParams(url.search);
      return { pathname: url.pathname, q: params.get("q") };
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual({ pathname: '/path', q: 'test' });
  });

  it('should have access to atob/btoa', async () => {
    const code = `return btoa("hello");`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe('aGVsbG8=');
  });

  it('should have access to structuredClone', async () => {
    const code = `
      const original = { a: 1, b: { c: 2 } };
      const cloned = structuredClone(original);
      cloned.b.c = 99;
      return { original: original.b.c, cloned: cloned.b.c };
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual({ original: 2, cloned: 99 });
  });

  it('should propagate script errors', async () => {
    await expect(_executeCode('throw new Error("script error");', sandbox, 5000))
      .rejects.toThrow('script error');
  });

  it('should timeout on long-running scripts', async () => {
    // Use a never-resolving Promise (setTimeout is blocked by sandbox)
    const code = `
      await new Promise(() => {});
      return "done";
    `;
    await expect(_executeCode(code, sandbox, 50))
      .rejects.toThrow(ScriptTimeoutError);
  }, 10000);

  it('should clear timeout timer on success', async () => {
    // Should not leak timers
    const result = await _executeCode('return 1;', sandbox, 5000);
    expect(result).toBe(1);
  });

  it('should clear timeout timer on error', async () => {
    await expect(_executeCode('throw new Error("fail");', sandbox, 5000))
      .rejects.toThrow('fail');
  });

  it('should execute TypeScript syntax (type annotations)', async () => {
    const code = `
      const x: number = 42;
      const y: string = "hello";
      return \`\${y} \${x}\`;
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe('hello 42');
  });

  it('should execute TypeScript interfaces and types', async () => {
    const code = `
      interface Point { x: number; y: number; }
      type Result = { value: number };
      const p: Point = { x: 1, y: 2 };
      const r: Result = { value: p.x + p.y };
      return r.value;
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe(3);
  });

  it('should return undefined when script has no return', async () => {
    const result = await _executeCode('const x = 42;', sandbox, 5000);
    expect(result).toBeUndefined();
  });

  it('should support array methods', async () => {
    const code = `
      const arr = [1, 2, 3, 4, 5];
      return arr.filter(x => x > 2).map(x => x * 10);
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual([30, 40, 50]);
  });

  it('should support Promise.all', async () => {
    const code = `
      const results = await Promise.all([
        Promise.resolve(1),
        Promise.resolve(2),
        Promise.resolve(3),
      ]);
      return results;
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual([1, 2, 3]);
  });
});

// ============================================================
// executeScriptCode
// ============================================================

describe('executeScriptCode', () => {
  let sandbox: ScriptSandbox;

  beforeEach(() => {
    sandbox = createSandbox(createMockRtcAgent(), {}, createOutput());
  });

  it('should execute code with default timeout', async () => {
    const result = await executeScriptCode('return 42;', sandbox);
    expect(result).toBe(42);
  });

  it('should execute code with custom timeout', async () => {
    const result = await executeScriptCode('return 42;', sandbox, 5000);
    expect(result).toBe(42);
  });

  it('should apply sandbox security (block dangerous code)', async () => {
    await expect(executeScriptCode('return fetch("https://example.com");', sandbox))
      .rejects.toThrow(ScriptCompileError);
  });
});

// ============================================================
// saveScript
// ============================================================

describe('saveScript', () => {
  beforeEach(async () => {
    getDatabase(TEST_DB);
  });

  afterEach(async () => {
    await closeDatabase();
  });
  it('should save script to virtual FS', async () => {
    const path = await saveScript('test-save', 'const x = 42;');
    expect(path).toBe('/scripts/test-save.ts');

    const content = await virtualFS.read(path);
    expect(content).toContain('name: "test-save"');
    expect(content).toContain('const x = 42;');
  });

  it('should include description when provided', async () => {
    const path = await saveScript('test-desc', 'const x = 1;', 'My script');
    const content = await virtualFS.read(path);
    expect(content).toContain('description: "My script"');
  });

  it('should overwrite existing scripts', async () => {
    const path1 = await saveScript('overwrite', 'const x = 1;');
    const path2 = await saveScript('overwrite', 'const x = 2;');
    expect(path1).toBe(path2);

    const content = await virtualFS.read(path2);
    expect(content).toContain('const x = 2;');
  });
});

// ============================================================
// loadAndExecuteScript
// ============================================================

describe('loadAndExecuteScript', () => {
  beforeEach(async () => {
    getDatabase(TEST_DB);
    // Ensure virtual FS is ready
    await virtualFS.write('/scripts/.keep', '', 'overwrite');
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('should load and execute a saved script', async () => {
    await saveScript('hello', `
      const greeting = "Hello, " + params.name + "!";
      return greeting;
    `);

    const result = await loadAndExecuteScript('hello', createMockRtcAgent(), { name: 'World' });
    expect(result).toBe('Hello, World!');
  });

  it('should pass params to script sandbox', async () => {
    await saveScript('params-test', `return params.x + params.y;`);

    const result = await loadAndExecuteScript('params-test', createMockRtcAgent(), { x: 10, y: 20 });
    expect(result).toBe(30);
  });

  it('should throw when script file does not exist', async () => {
    await expect(
      loadAndExecuteScript('nonexistent', createMockRtcAgent())
    ).rejects.toThrow();
  });

  it('should apply timeout to loaded script', async () => {
    // Use a never-resolving Promise (setTimeout is blocked by sandbox)
    await saveScript('timeout-test', `
      await new Promise(() => {});
    `);

    await expect(
      loadAndExecuteScript('timeout-test', createMockRtcAgent(), {}, 50)
    ).rejects.toThrow(ScriptTimeoutError);
  }, 10000);
});

// ============================================================
// Edge cases & integration
// ============================================================

describe('edge cases', () => {
  let sandbox: ScriptSandbox;

  beforeEach(() => {
    sandbox = createSandbox(createMockRtcAgent(), {}, createOutput());
  });

  it('should handle empty script', async () => {
    const result = await _executeCode('', sandbox, 5000);
    expect(result).toBeUndefined();
  });

  it('should handle script with only comments', async () => {
    const result = await _executeCode('// just a comment', sandbox, 5000);
    expect(result).toBeUndefined();
  });

  it('should handle script returning complex objects', async () => {
    const code = `
      return {
        nested: { a: [1, 2, 3] },
        date: new Date(2026, 0, 1).toISOString(),
        regex: /test/.test('testing'),
      };
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual(expect.objectContaining({
      nested: { a: [1, 2, 3] },
      regex: true,
    }));
  });

  it('should handle concurrent script executions', async () => {
    const code1 = `return 1 + 1;`;
    const code2 = `return 2 + 2;`;
    const code3 = `return 3 + 3;`;

    const [r1, r2, r3] = await Promise.all([
      _executeCode(code1, sandbox, 5000),
      _executeCode(code2, sandbox, 5000),
      _executeCode(code3, sandbox, 5000),
    ]);

    expect(r1).toBe(2);
    expect(r2).toBe(4);
    expect(r3).toBe(6);
  });

  it('should not leak variables between executions', async () => {
    await _executeCode('var leakTest = "leaked";', sandbox, 5000);
    // The next execution should not have access to 'leakTest'
    // (each execution is a new function scope)
    const result = await _executeCode('return typeof leakTest;', sandbox, 5000);
    expect(result).toBe('undefined');
  });

  it('should handle BigInt in scripts', async () => {
    const code = `return BigInt(123) + BigInt(456);`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe(BigInt(579));
  });

  it('should handle Symbol in scripts', async () => {
    const code = `return typeof Symbol("test");`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe('symbol');
  });

  it('should handle Error subclasses in scripts', async () => {
    const code = `
      try {
        throw new TypeError("type error");
      } catch (e) {
        return e.message;
      }
    `;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toBe('type error');
  });

  it('should handle NaN and Infinity', async () => {
    const code = `return { isNaN: isNaN(NaN), isInf: Infinity > 0 };`;
    const result = await _executeCode(code, sandbox, 5000);
    expect(result).toEqual({ isNaN: true, isInf: true });
  });
});

// ============================================================
// Script Parameters
// ============================================================

describe('Script Parameters', () => {
  let sandbox: ScriptSandbox;
  let output: ConsoleOutput;

  beforeEach(() => {
    output = createOutput();
  });

  describe('Basic parameter access', () => {
    it('should access string parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { name: 'Alice' }, output);
      const code = `return \`Hello, \${params.name}!\`;`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('Hello, Alice!');
    });

    it('should access number parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { count: 42 }, output);
      const code = `return params.count * 2;`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe(84);
    });

    it('should access boolean parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { flag: true }, output);
      const code = `return params.flag ? 'yes' : 'no';`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('yes');
    });

    it('should access object parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { user: { name: 'Bob', age: 30 } }, output);
      const code = `return \`\${params.user.name} is \${params.user.age} years old\`;`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('Bob is 30 years old');
    });

    it('should access array parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { items: [1, 2, 3] }, output);
      const code = `return params.items.reduce((a, b) => a + b, 0);`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe(6);
    });

    it('should handle multiple parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        format: 'json'
      }, output);
      const code = `
        const { startDate, endDate, format } = params;
        return { range: \`\${startDate} to \${endDate}\`, outputFormat: format };
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toEqual({
        range: '2024-01-01 to 2024-12-31',
        outputFormat: 'json'
      });
    });
  });

  describe('Default values and missing parameters', () => {
    it('should handle missing parameters with default values', async () => {
      sandbox = createSandbox(createMockRtcAgent(), {}, output);
      const code = `
        const { name = 'Guest', count = 0 } = params;
        return \`\${name}: \${count}\`;
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('Guest: 0');
    });

    it('should handle undefined parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { name: undefined }, output);
      const code = `return params.name || 'default';`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('default');
    });

    it('should handle null parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { value: null }, output);
      const code = `return params.value ?? 'fallback';`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('fallback');
    });

    it('should use optional chaining for nested parameters', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { user: { name: 'Alice' } }, output);
      const code = `return params.user?.age ?? 'unknown';`;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('unknown');
    });
  });

  describe('Parameter types and validation', () => {
    it('should preserve parameter types', async () => {
      sandbox = createSandbox(createMockRtcAgent(), {
        str: 'text',
        num: 123,
        bool: true,
        obj: { key: 'value' },
        arr: [1, 2, 3]
      }, output);
      const code = `
        return {
          strType: typeof params.str,
          numType: typeof params.num,
          boolType: typeof params.bool,
          objType: typeof params.obj,
          arrType: Array.isArray(params.arr)
        };
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toEqual({
        strType: 'string',
        numType: 'number',
        boolType: 'boolean',
        objType: 'object',
        arrType: true
      });
    });

    it('should handle complex nested structures', async () => {
      sandbox = createSandbox(createMockRtcAgent(), {
        data: {
          users: [
            { name: 'Alice', tags: ['admin', 'user'] },
            { name: 'Bob', tags: ['user'] }
          ],
          metadata: { count: 2 }
        }
      }, output);
      const code = `
        return {
          firstUser: params.data.users[0].name,
          firstUserTags: params.data.users[0].tags,
          totalUsers: params.data.metadata.count
        };
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toEqual({
        firstUser: 'Alice',
        firstUserTags: ['admin', 'user'],
        totalUsers: 2
      });
    });
  });

  describe('Parameter usage patterns', () => {
    it('should use params in loops', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { items: ['a', 'b', 'c'] }, output);
      const code = `
        const result = [];
        for (const item of params.items) {
          result.push(item.toUpperCase());
        }
        return result;
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toEqual(['A', 'B', 'C']);
    });

    it('should use params in conditional logic', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { threshold: 10, value: 15 }, output);
      const code = `
        if (params.value > params.threshold) {
          return 'above threshold';
        } else {
          return 'below threshold';
        }
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe('above threshold');
    });

    it('should use params in function calls', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { numbers: [1, 2, 3, 4, 5] }, output);
      const code = `
        function sum(arr) {
          return arr.reduce((a, b) => a + b, 0);
        }
        return sum(params.numbers);
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe(15);
    });

    it('should use params with async/await', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { items: [1, 2, 3] }, output);
      const code = `
        async function processItems(arr) {
          const results = [];
          for (const item of arr) {
            results.push(item * 2);
          }
          return results;
        }
        return await processItems(params.items);
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toEqual([2, 4, 6]);
    });
  });

  describe('Parameter immutability', () => {
    it('should allow modifying params object', async () => {
      sandbox = createSandbox(createMockRtcAgent(), { count: 1 }, output);
      const code = `
        params.count += 1;
        return params.count;
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toBe(2);
    });

    it('should not leak param modifications between executions', async () => {
      const params = { count: 1 };
      sandbox = createSandbox(createMockRtcAgent(), params, output);

      await _executeCode('params.count = 999;', sandbox, 5000);

      // Create new sandbox with same params object
      sandbox = createSandbox(createMockRtcAgent(), params, output);
      const result = await _executeCode('return params.count;', sandbox, 5000);
      expect(result).toBe(999); // Params object is shared, so modification persists
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle data transformation with params', async () => {
      sandbox = createSandbox(createMockRtcAgent(), {
        data: [
          { name: 'Alice', score: 85 },
          { name: 'Bob', score: 92 },
          { name: 'Charlie', score: 78 }
        ],
        minScore: 80
      }, output);
      const code = `
        const { data, minScore } = params;
        const passed = data.filter(student => student.score >= minScore);
        return {
          passed: passed.map(s => s.name),
          average: passed.reduce((sum, s) => sum + s.score, 0) / passed.length
        };
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result.passed).toEqual(['Alice', 'Bob']);
      expect(result.average).toBe(88.5);
    });

    it('should handle date range processing with params', async () => {
      sandbox = createSandbox(createMockRtcAgent(), {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        events: [
          { date: '2024-01-05', title: 'Event 1' },
          { date: '2024-01-15', title: 'Event 2' },
          { date: '2024-02-05', title: 'Event 3' }
        ]
      }, output);
      const code = `
        const { startDate, endDate, events } = params;
        const start = new Date(startDate);
        const end = new Date(endDate);
        const filtered = events.filter(e => {
          const d = new Date(e.date);
          return d >= start && d <= end;
        });
        return filtered;
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Event 1');
      expect(result[1].title).toBe('Event 2');
    });

    it('should handle configuration-based processing', async () => {
      sandbox = createSandbox(createMockRtcAgent(), {
        config: {
          enableLogging: true,
          maxRetries: 3,
          timeout: 5000
        }
      }, output);
      const code = `
        const { config } = params;
        if (config.enableLogging) {
          console.log('Processing with config:', JSON.stringify(config));
        }
        return {
          retries: config.maxRetries,
          timeout: config.timeout
        };
      `;
      const result = await _executeCode(code, sandbox, 5000);
      expect(result).toEqual({ retries: 3, timeout: 5000 });
      expect(output.logs).toHaveLength(1);
      expect(output.logs[0]).toContain('Processing with config');
    });
  });
});

