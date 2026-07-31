// Data format tools: JSON, YAML, CSV, XML, Markdown. Pure compute.
const need = (v, name) => {
  if (typeof v !== "string" || !v.length) {
    throw Object.assign(new Error(`${name} is required`), { status: 400 });
  }
  if (v.length > 5_000_000) throw Object.assign(new Error(`${name} too large`), { status: 413 });
  return v;
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw Object.assign(new Error(`invalid JSON: ${e.message}`), { status: 400 });
  }
};

export const tools = {
  json_format: {
    price: 0.005,
    description:
      'Format, minify or validate JSON. POST {"json": "...", "mode": "pretty"|"minify"|"validate", "indent": 2} -> formatted output or validation error with position.',
    output: { result: "string", valid: true },
    example: { json: '{"b":2,"a":1}', mode: "pretty" },
    run: ({ json, mode = "pretty", indent = 2, sortKeys = false }) => {
      need(json, "json");
      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch (e) {
        if (mode === "validate") return { valid: false, error: e.message };
        throw Object.assign(new Error(`invalid JSON: ${e.message}`), { status: 400 });
      }
      if (mode === "validate") return { valid: true, type: Array.isArray(parsed) ? "array" : typeof parsed };
      const sorter = sortKeys
        ? (obj) => {
            if (Array.isArray(obj)) return obj.map(sorter);
            if (obj && typeof obj === "object") {
              return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sorter(obj[k])]));
            }
            return obj;
          }
        : (o) => o;
      const value = sorter(parsed);
      return {
        result: mode === "minify" ? JSON.stringify(value) : JSON.stringify(value, null, Math.min(Number(indent) || 2, 8)),
        valid: true,
      };
    },
  },

  json_query: {
    price: 0.01,
    description:
      'Query JSON with a dot/bracket path. POST {"json": "...", "path": "users[0].name"} -> the value at that path. Supports [*] to map over arrays.',
    output: { value: "any", found: true },
    example: { json: '{"users":[{"name":"ada"},{"name":"bob"}]}', path: "users[*].name" },
    run: ({ json, path }) => {
      const data = parseJson(need(json, "json"));
      need(path, "path");
      const parts = path.replace(/\[(\*|\d+)\]/g, ".$1").split(".").filter(Boolean);
      let current = [data];
      for (const part of parts) {
        const next = [];
        for (const node of current) {
          if (node == null) continue;
          if (part === "*") {
            if (Array.isArray(node)) next.push(...node);
            else if (typeof node === "object") next.push(...Object.values(node));
          } else if (Array.isArray(node) && /^\d+$/.test(part)) {
            next.push(node[Number(part)]);
          } else if (typeof node === "object") {
            next.push(node[part]);
          }
        }
        current = next.filter((v) => v !== undefined);
      }
      const multi = path.includes("[*]") || path.includes(".*");
      return { value: multi ? current : current[0] ?? null, found: current.length > 0, matches: current.length };
    },
  },

  json_to_csv: {
    price: 0.01,
    description:
      'Convert a JSON array of objects to CSV. POST {"json": "[{...}]", "delimiter": ","} -> CSV text.',
    output: { csv: "string", rows: 0 },
    example: { json: '[{"a":1,"b":2},{"a":3,"b":4}]' },
    run: async ({ json, delimiter = "," }) => {
      const data = parseJson(need(json, "json"));
      if (!Array.isArray(data)) throw Object.assign(new Error("json must be an array"), { status: 400 });
      const Papa = (await import("papaparse")).default;
      return { csv: Papa.unparse(data, { delimiter }), rows: data.length };
    },
  },

  csv_to_json: {
    price: 0.01,
    description:
      'Convert CSV to JSON. POST {"csv": "...", "header": true, "delimiter": ","} -> array of objects (or arrays when header is false).',
    output: { data: [{}], rows: 0 },
    example: { csv: "a,b\n1,2\n3,4" },
    run: async ({ csv, header = true, delimiter }) => {
      need(csv, "csv");
      const Papa = (await import("papaparse")).default;
      const parsed = Papa.parse(csv.trim(), {
        header: Boolean(header),
        delimiter: delimiter ?? "",
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      return { data: parsed.data, rows: parsed.data.length, fields: parsed.meta?.fields ?? null };
    },
  },

  yaml_convert: {
    price: 0.01,
    description:
      'Convert between YAML and JSON. POST {"text": "...", "to": "json"|"yaml"} -> converted document.',
    output: { result: "string" },
    example: { text: "name: test\nitems:\n  - one\n  - two", to: "json" },
    run: async ({ text, to = "json" }) => {
      need(text, "text");
      const yamlMod = await import("js-yaml");
      const yaml = yamlMod.default ?? yamlMod;
      try {
        if (to === "yaml") {
          return { result: yaml.dump(JSON.parse(text)), to: "yaml" };
        }
        return { result: JSON.stringify(yaml.load(text), null, 2), to: "json" };
      } catch (e) {
        throw Object.assign(new Error(`conversion failed: ${e.message}`), { status: 400 });
      }
    },
  },

  xml_to_json: {
    price: 0.01,
    description: 'Convert XML to JSON. POST {"xml": "<root>...</root>"} -> parsed object.',
    output: { data: {} },
    example: { xml: "<root><item>one</item><item>two</item></root>" },
    run: async ({ xml }) => {
      need(xml, "xml");
      const { XMLParser } = await import("fast-xml-parser");
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
      try {
        return { data: parser.parse(xml) };
      } catch (e) {
        throw Object.assign(new Error(`invalid XML: ${e.message}`), { status: 400 });
      }
    },
  },

  markdown_to_html: {
    price: 0.01,
    description: 'Render Markdown to HTML. POST {"markdown": "# Title"} -> HTML string.',
    output: { html: "string" },
    example: { markdown: "# Hello\n\nSome **bold** text." },
    run: async ({ markdown }) => {
      need(markdown, "markdown");
      const { marked } = await import("marked");
      return { html: await marked.parse(markdown) };
    },
  },

  jwt_decode: {
    price: 0.01,
    description:
      'Decode a JWT without verifying it. POST {"token": "eyJ..."} -> header, payload, expiry status. Signature is NOT verified.',
    output: { header: {}, payload: {}, expired: false },
    example: { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig" },
    run: ({ token }) => {
      need(token, "token");
      const parts = token.split(".");
      if (parts.length < 2) throw Object.assign(new Error("not a JWT"), { status: 400 });
      const dec = (p) => {
        try {
          return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        } catch {
          throw Object.assign(new Error("malformed JWT segment"), { status: 400 });
        }
      };
      const header = dec(parts[0]);
      const payload = dec(parts[1]);
      const now = Math.floor(Date.now() / 1000);
      return {
        header,
        payload,
        expired: typeof payload.exp === "number" ? payload.exp < now : null,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
        note: "Signature not verified — decode only.",
      };
    },
  },

  rss_parse: {
    price: 0.02,
    description:
      'Parse an RSS or Atom feed. POST {"url": "https://..."} or {"xml": "..."} -> feed title and items with links and dates.',
    output: { title: "string", items: [{ title: "string", link: "string" }] },
    example: { url: "https://hnrss.org/frontpage" },
    run: async ({ url, xml, limit = 25 }) => {
      let body = xml;
      if (!body) {
        need(url, "url");
        const u = new URL(url);
        if (!["http:", "https:"].includes(u.protocol)) throw Object.assign(new Error("bad url"), { status: 400 });
        const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "blixtworks-tools/1.0" } });
        if (!res.ok) throw Object.assign(new Error(`fetch failed: ${res.status}`), { status: 422 });
        body = await res.text();
      }
      const { XMLParser } = await import("fast-xml-parser");
      const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(body);
      const channel = parsed?.rss?.channel ?? parsed?.feed ?? {};
      const rawItems = channel.item ?? channel.entry ?? [];
      const arr = Array.isArray(rawItems) ? rawItems : [rawItems];
      const items = arr.slice(0, Math.min(Number(limit) || 25, 100)).map((it) => ({
        title: typeof it.title === "object" ? it.title["#text"] ?? "" : it.title ?? "",
        link: typeof it.link === "object" ? it.link["@href"] ?? "" : it.link ?? "",
        published: it.pubDate ?? it.published ?? it.updated ?? null,
        summary: typeof it.description === "string" ? it.description.slice(0, 500) : null,
      }));
      return {
        title: typeof channel.title === "object" ? channel.title["#text"] : channel.title ?? "",
        items,
        count: items.length,
      };
    },
  },

  sitemap_parse: {
    price: 0.02,
    description:
      'Parse a sitemap.xml (including sitemap indexes). POST {"url": "https://example.com/sitemap.xml"} -> URLs with last-modified dates.',
    output: { urls: [{ loc: "string", lastmod: "string" }] },
    example: { url: "https://www.blixtworks.com/sitemap.xml" },  // served by this service
    run: async ({ url, limit = 500 }) => {
      need(url, "url");
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "blixtworks-tools/1.0" } });
      if (!res.ok) throw Object.assign(new Error(`fetch failed: ${res.status}`), { status: 422 });
      const { XMLParser } = await import("fast-xml-parser");
      const parsed = new XMLParser().parse(await res.text());
      const isIndex = Boolean(parsed?.sitemapindex);
      const raw = parsed?.urlset?.url ?? parsed?.sitemapindex?.sitemap ?? [];
      const arr = Array.isArray(raw) ? raw : [raw];
      const urls = arr.slice(0, Math.min(Number(limit) || 500, 5000)).map((u) => ({
        loc: u.loc ?? "",
        lastmod: u.lastmod ?? null,
      }));
      return { urls, count: urls.length, isSitemapIndex: isIndex };
    },
  },
};

tools.pdf = {
  price: 0.03,
  description:
    'PDF text extraction. POST {"pdf": "<https url or data:application/pdf base64 URI>"} -> plain text, page count and metadata.',
  output: { text: "string", pages: 0, info: {} },
  example: { pdf: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
  run: async ({ pdf }) => {
    if (typeof pdf !== "string") throw Object.assign(new Error("provide pdf url or data URI"), { status: 400 });
    let buf;
    if (pdf.startsWith("data:application/pdf")) {
      buf = Buffer.from(pdf.slice(pdf.indexOf(",") + 1), "base64");
    } else {
      const u = new URL(pdf);
      if (!["http:", "https:"].includes(u.protocol) || /^(localhost$|127\.|10\.|192\.168\.|169\.254\.)/i.test(u.hostname)) {
        throw Object.assign(new Error("pdf url not allowed"), { status: 400 });
      }
      const res = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { "user-agent": "blixtworks-tools/1.0" } });
      if (!res.ok) throw Object.assign(new Error(`fetch failed: ${res.status}`), { status: 422 });
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (buf.length > 25_000_000) throw Object.assign(new Error("pdf too large"), { status: 413 });
    const { createRequire } = await import("node:module");
    const { PDFParse } = createRequire(import.meta.url)("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const result = await parser.getText();
      return {
        text: result.text?.slice(0, 2_000_000) ?? "",
        pages: result.total ?? null,
        info: { title: result.info?.Title ?? null, author: result.info?.Author ?? null },
      };
    } finally {
      await parser.destroy?.().catch?.(() => {});
    }
  },
};
