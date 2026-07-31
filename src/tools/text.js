// Text and string tools. Pure compute, no network, no models.
import crypto from "node:crypto";

const need = (v, name) => {
  if (typeof v !== "string" || !v.length) {
    throw Object.assign(new Error(`${name} is required`), { status: 400 });
  }
  if (v.length > 2_000_000) throw Object.assign(new Error(`${name} too large`), { status: 413 });
  return v;
};

export const tools = {
  hash: {
    price: 0.005,
    description:
      'Cryptographic hashes. POST {"text": "...", "algorithms": ["sha256","md5"]} -> hex digests (default md5, sha1, sha256, sha512).',
    output: { hashes: { sha256: "hex" } },
    example: { text: "hello world", algorithms: ["sha256"] },
    run: ({ text, algorithms }) => {
      need(text, "text");
      const algos = Array.isArray(algorithms) && algorithms.length
        ? algorithms.slice(0, 8).map(String)
        : ["md5", "sha1", "sha256", "sha512"];
      const available = new Set(crypto.getHashes());
      const hashes = {};
      for (const a of algos) {
        if (!available.has(a)) throw Object.assign(new Error(`unsupported algorithm: ${a}`), { status: 400 });
        hashes[a] = crypto.createHash(a).update(text).digest("hex");
      }
      return { hashes };
    },
  },

  hmac: {
    price: 0.005,
    description:
      'HMAC signature. POST {"text": "...", "key": "...", "algorithm": "sha256"} -> hex and base64 signature.',
    output: { hex: "string", base64: "string" },
    example: { text: "payload", key: "secret", algorithm: "sha256" },
    run: ({ text, key, algorithm = "sha256" }) => {
      need(text, "text");
      need(key, "key");
      if (!crypto.getHashes().includes(algorithm)) {
        throw Object.assign(new Error("unsupported algorithm"), { status: 400 });
      }
      const digest = (enc) => crypto.createHmac(algorithm, key).update(text).digest(enc);
      return { hex: digest("hex"), base64: digest("base64"), algorithm };
    },
  },

  uuid: {
    price: 0.005,
    description: 'Generate UUIDs. POST {"count": 5, "version": "v4"} -> list of UUIDs (max 100).',
    output: { uuids: ["string"] },
    example: { count: 3 },
    run: ({ count = 1 }) => {
      const n = Math.min(Math.max(Number(count) || 1, 1), 100);
      return { uuids: Array.from({ length: n }, () => crypto.randomUUID()), count: n };
    },
  },

  base64: {
    price: 0.005,
    description:
      'Base64 encode or decode. POST {"text": "...", "mode": "encode"|"decode", "urlSafe": false} -> result.',
    output: { result: "string" },
    example: { text: "hello", mode: "encode" },
    run: ({ text, mode = "encode", urlSafe = false }) => {
      need(text, "text");
      if (mode === "decode") {
        const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
        return { result: Buffer.from(normalized, "base64").toString("utf8"), mode };
      }
      let out = Buffer.from(text, "utf8").toString("base64");
      if (urlSafe) out = out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return { result: out, mode: "encode" };
    },
  },

  slugify: {
    price: 0.005,
    description: 'URL-safe slug from any text. POST {"text": "Hällö Wörld!"} -> {"slug": "hallo-world"}.',
    output: { slug: "string" },
    example: { text: "Hello World! Åäö" },
    run: ({ text, separator = "-" }) => {
      need(text, "text");
      const slug = text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9\s-_]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, separator === "_" ? "_" : "-");
      return { slug };
    },
  },

  case_convert: {
    price: 0.005,
    description:
      'Convert text case. POST {"text": "...", "to": "camel"|"snake"|"kebab"|"pascal"|"upper"|"lower"|"title"} -> converted text.',
    output: { result: "string" },
    example: { text: "hello world example", to: "camel" },
    run: ({ text, to = "snake" }) => {
      need(text, "text");
      const words = text.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean);
      const lower = words.map((w) => w.toLowerCase());
      const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
      const map = {
        camel: lower.map((w, i) => (i ? cap(w) : w)).join(""),
        pascal: lower.map(cap).join(""),
        snake: lower.join("_"),
        kebab: lower.join("-"),
        constant: lower.join("_").toUpperCase(),
        upper: text.toUpperCase(),
        lower: text.toLowerCase(),
        title: lower.map(cap).join(" "),
      };
      if (!(to in map)) throw Object.assign(new Error(`unknown case: ${to}`), { status: 400 });
      return { result: map[to], to };
    },
  },

  text_stats: {
    price: 0.005,
    description:
      'Text statistics. POST {"text": "..."} -> characters, words, sentences, paragraphs, reading time, top words.',
    output: { words: 0, readingTimeMinutes: 0 },
    example: { text: "The quick brown fox jumps over the lazy dog." },
    run: ({ text }) => {
      need(text, "text");
      const words = text.trim().split(/\s+/).filter(Boolean);
      const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length);
      const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length);
      const freq = {};
      const stop = new Set("the a an and or but of to in on at for is are was were be been it this that with as by from".split(" "));
      for (const w of words) {
        const k = w.toLowerCase().replace(/[^a-z0-9']/g, "");
        if (k && !stop.has(k)) freq[k] = (freq[k] ?? 0) + 1;
      }
      const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([word, count]) => ({ word, count }));
      return {
        characters: text.length,
        charactersNoSpaces: text.replace(/\s/g, "").length,
        words: words.length,
        sentences: sentences.length,
        paragraphs: paragraphs.length,
        readingTimeMinutes: Number((words.length / 200).toFixed(2)),
        averageWordLength: Number((words.join("").length / (words.length || 1)).toFixed(2)),
        topWords,
      };
    },
  },

  regex: {
    price: 0.005,
    description:
      'Test a regular expression and extract matches. POST {"text": "...", "pattern": "\\\\d+", "flags": "g"} -> matches with groups and indices.',
    output: { matches: [{ match: "string", index: 0, groups: [] }] },
    example: { text: "order 123 and 456", pattern: "\\d+", flags: "g" },
    run: ({ text, pattern, flags = "g" }) => {
      need(text, "text");
      need(pattern, "pattern");
      if (!/^[gimsuy]*$/.test(flags)) throw Object.assign(new Error("invalid flags"), { status: 400 });
      let re;
      try {
        re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
      } catch (e) {
        throw Object.assign(new Error(`invalid pattern: ${e.message}`), { status: 400 });
      }
      const matches = [];
      for (const m of text.matchAll(re)) {
        matches.push({ match: m[0], index: m.index, groups: m.slice(1), named: m.groups ?? null });
        if (matches.length >= 500) break;
      }
      return { matches, count: matches.length };
    },
  },

  diff: {
    price: 0.01,
    description:
      'Compare two texts. POST {"a": "...", "b": "...", "mode": "lines"|"words"|"chars"} -> unified diff plus added/removed counts.',
    output: { diff: "string", added: 0, removed: 0 },
    example: { a: "line one\nline two", b: "line one\nline 2" },
    run: async ({ a, b, mode = "lines" }) => {
      need(a, "a");
      need(b, "b");
      const D = await import("diff");
      const fn = mode === "words" ? D.diffWords : mode === "chars" ? D.diffChars : D.diffLines;
      const parts = fn(a, b);
      let added = 0;
      let removed = 0;
      const out = [];
      for (const p of parts) {
        if (p.added) {
          added += p.count ?? 1;
          out.push(p.value.split("\n").filter(Boolean).map((l) => `+ ${l}`).join("\n"));
        } else if (p.removed) {
          removed += p.count ?? 1;
          out.push(p.value.split("\n").filter(Boolean).map((l) => `- ${l}`).join("\n"));
        } else if (mode === "lines") {
          out.push(p.value.split("\n").filter(Boolean).map((l) => `  ${l}`).join("\n"));
        } else {
          out.push(p.value);
        }
      }
      return { diff: out.filter(Boolean).join("\n"), added, removed, identical: added === 0 && removed === 0 };
    },
  },

  language_detect: {
    price: 0.01,
    description: 'Detect the language of a text. POST {"text": "..."} -> ISO 639-3 code and name.',
    output: { language: "string", code: "string" },
    example: { text: "Hej, hur mår du idag?" },
    run: async ({ text }) => {
      need(text, "text");
      const { franc } = await import("franc");
      const code = franc(text);
      const shortText = text.trim().length < 25;
      const names = {
        eng: "English", swe: "Swedish", nob: "Norwegian", dan: "Danish", fin: "Finnish",
        deu: "German", fra: "French", spa: "Spanish", por: "Portuguese", ita: "Italian",
        nld: "Dutch", pol: "Polish", rus: "Russian", ukr: "Ukrainian", ces: "Czech",
        cmn: "Chinese", jpn: "Japanese", kor: "Korean", ara: "Arabic", hin: "Hindi",
        tur: "Turkish", ell: "Greek", heb: "Hebrew", vie: "Vietnamese", tha: "Thai",
      };
      return {
        code,
        language: names[code] ?? (code === "und" ? "undetermined" : code),
        confident: code !== "und" && !shortText,
        note: shortText ? "Short input — language detection is unreliable below ~25 characters." : undefined,
      };
    },
  },

  word_frequency: {
    price: 0.01,
    description:
      'Word and n-gram frequency analysis. POST {"text": "...", "ngram": 1, "limit": 20, "stopwords": true} -> ranked terms.',
    output: { terms: [{ term: "string", count: 0 }] },
    example: { text: "the cat sat on the mat the cat", ngram: 1, limit: 5 },
    run: ({ text, ngram = 1, limit = 20, stopwords = true }) => {
      need(text, "text");
      const n = Math.min(Math.max(Number(ngram) || 1, 1), 5);
      const lim = Math.min(Math.max(Number(limit) || 20, 1), 200);
      const stop = new Set("the a an and or but of to in on at for is are was were be been it this that with as by from i you he she they we".split(" "));
      let words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
      if (stopwords && n === 1) words = words.filter((w) => !stop.has(w));
      const freq = {};
      for (let i = 0; i <= words.length - n; i++) {
        const term = words.slice(i, i + n).join(" ");
        freq[term] = (freq[term] ?? 0) + 1;
      }
      const terms = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, lim)
        .map(([term, count]) => ({ term, count }));
      return { terms, totalWords: words.length, unique: Object.keys(freq).length };
    },
  },

  lorem: {
    price: 0.005,
    description: 'Generate placeholder text. POST {"paragraphs": 2, "wordsPerParagraph": 40} -> lorem ipsum text.',
    output: { text: "string" },
    example: { paragraphs: 2 },
    run: ({ paragraphs = 1, wordsPerParagraph = 50 }) => {
      const vocab = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");
      const p = Math.min(Math.max(Number(paragraphs) || 1, 1), 20);
      const w = Math.min(Math.max(Number(wordsPerParagraph) || 50, 5), 300);
      const out = [];
      for (let i = 0; i < p; i++) {
        const words = Array.from({ length: w }, () => vocab[Math.floor(Math.random() * vocab.length)]);
        let s = words.join(" ");
        s = s.charAt(0).toUpperCase() + s.slice(1) + ".";
        out.push(s);
      }
      return { text: out.join("\n\n"), paragraphs: p };
    },
  },
};
