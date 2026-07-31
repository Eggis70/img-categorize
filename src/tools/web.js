// Web and network tools. Public data only, with SSRF guards on every fetch.
import tls from "node:tls";
import dnsPromises from "node:dns/promises";

const BLOCKED_HOSTS = /^(localhost$|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1)/i;

function safeUrl(raw, name = "url") {
  if (typeof raw !== "string" || !raw.length) {
    throw Object.assign(new Error(`${name} is required`), { status: 400 });
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Object.assign(new Error(`invalid ${name}`), { status: 400 });
  }
  if (!["http:", "https:"].includes(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) {
    throw Object.assign(new Error(`${name} not allowed`), { status: 400 });
  }
  return u;
}

function safeDomain(d) {
  if (typeof d !== "string" || !/^[a-z0-9.-]{1,253}$/i.test(d) || BLOCKED_HOSTS.test(d)) {
    throw Object.assign(new Error("invalid domain"), { status: 400 });
  }
  return d.toLowerCase();
}

const UA = { "user-agent": "blixtworks-tools/1.0 (+https://www.blixtworks.com)" };

export const tools = {
  http_headers: {
    price: 0.01,
    description:
      'Inspect HTTP response headers for a URL. POST {"url": "https://...", "method": "HEAD"} -> status, headers, timing, redirect chain.',
    output: { status: 200, headers: {}, redirects: [] },
    example: { url: "https://www.blixtworks.com" },
    run: async ({ url, method = "HEAD" }) => {
      const u = safeUrl(url);
      const t0 = Date.now();
      const redirects = [];
      let current = u.toString();
      let res;
      for (let i = 0; i < 10; i++) {
        res = await fetch(current, {
          method: method === "GET" ? "GET" : "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
          headers: UA,
        });
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
          const next = new URL(loc, current).toString();
          redirects.push({ from: current, to: next, status: res.status });
          safeUrl(next);
          current = next;
          continue;
        }
        break;
      }
      return {
        finalUrl: current,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        redirects,
        elapsedMs: Date.now() - t0,
      };
    },
  },

  url_expand: {
    price: 0.01,
    description:
      'Expand a shortened URL by following redirects. POST {"url": "https://bit.ly/x"} -> final destination and hop chain.',
    output: { finalUrl: "string", hops: 0 },
    example: { url: "https://bit.ly/example" },
    run: async ({ url }) => {
      let current = safeUrl(url).toString();
      const chain = [current];
      for (let i = 0; i < 10; i++) {
        const res = await fetch(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15000), headers: UA });
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
          current = safeUrl(new URL(loc, current).toString()).toString();
          chain.push(current);
          continue;
        }
        break;
      }
      return { finalUrl: current, hops: chain.length - 1, chain };
    },
  },

  ssl_check: {
    price: 0.02,
    description:
      'Inspect a TLS certificate. POST {"domain": "example.com", "port": 443} -> issuer, subject, validity dates, days until expiry.',
    output: { issuer: "string", validTo: "string", daysRemaining: 0 },
    example: { domain: "www.blixtworks.com" },
    run: ({ domain, port = 443 }) => {
      const host = safeDomain(domain);
      const p = Math.min(Math.max(Number(port) || 443, 1), 65535);
      return new Promise((resolve, reject) => {
        const socket = tls.connect({ host, port: p, servername: host, timeout: 15000 }, () => {
          const cert = socket.getPeerCertificate();
          const proto = socket.getProtocol();
          socket.end();
          if (!cert || !cert.valid_to) {
            reject(Object.assign(new Error("no certificate returned"), { status: 422 }));
            return;
          }
          const validTo = new Date(cert.valid_to);
          resolve({
            domain: host,
            subject: cert.subject?.CN ?? null,
            issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
            altNames: cert.subjectaltname?.split(", ").map((s) => s.replace(/^DNS:/, "")) ?? [],
            validFrom: new Date(cert.valid_from).toISOString(),
            validTo: validTo.toISOString(),
            daysRemaining: Math.floor((validTo - Date.now()) / 86400000),
            expired: validTo < new Date(),
            protocol: proto,
          });
        });
        socket.on("error", (e) => reject(Object.assign(new Error(`TLS failed: ${e.message}`), { status: 422 })));
        socket.on("timeout", () => {
          socket.destroy();
          reject(Object.assign(new Error("TLS timeout"), { status: 422 }));
        });
      });
    },
  },

  whois: {
    price: 0.02,
    description:
      'Domain registration data via RDAP. POST {"domain": "example.com"} -> registrar, creation/expiry dates, nameservers, status.',
    output: { registrar: "string", created: "string", expires: "string" },
    example: { domain: "blixtworks.com" },
    run: async ({ domain }) => {
      const host = safeDomain(domain);
      const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(host)}`, {
        signal: AbortSignal.timeout(20000),
        headers: UA,
        redirect: "follow",
      });
      if (res.status === 404) return { domain: host, registered: false };
      if (!res.ok) throw Object.assign(new Error(`RDAP lookup failed: ${res.status}`), { status: 422 });
      const d = await res.json();
      const event = (a) => d.events?.find((e) => e.eventAction === a)?.eventDate ?? null;
      const registrar = d.entities?.find((e) => e.roles?.includes("registrar"));
      const registrarName = registrar?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3] ?? null;
      return {
        domain: host,
        registered: true,
        registrar: registrarName,
        created: event("registration"),
        expires: event("expiration"),
        updated: event("last changed"),
        status: d.status ?? [],
        nameservers: (d.nameservers ?? []).map((n) => n.ldhName),
      };
    },
  },

  robots_check: {
    price: 0.01,
    description:
      'Fetch and interpret robots.txt. POST {"url": "https://example.com", "userAgent": "GPTBot", "path": "/"} -> whether crawling is allowed, plus sitemaps.',
    output: { allowed: true, sitemaps: [] },
    example: { url: "https://example.com", userAgent: "GPTBot" },
    run: async ({ url, userAgent = "*", path = "/" }) => {
      const u = safeUrl(url);
      const res = await fetch(`${u.origin}/robots.txt`, { signal: AbortSignal.timeout(15000), headers: UA });
      if (!res.ok) return { origin: u.origin, robotsFound: false, allowed: true, sitemaps: [] };
      const text = (await res.text()).slice(0, 500_000);
      const sitemaps = [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      const groups = {};
      let currentAgents = [];
      for (const line of text.split("\n")) {
        const clean = line.split("#")[0].trim();
        const ua = clean.match(/^user-agent:\s*(.+)$/i);
        if (ua) {
          currentAgents = [ua[1].trim().toLowerCase()];
          groups[currentAgents[0]] ??= { allow: [], disallow: [] };
          continue;
        }
        const dis = clean.match(/^disallow:\s*(.*)$/i);
        const allow = clean.match(/^allow:\s*(.*)$/i);
        for (const a of currentAgents) {
          groups[a] ??= { allow: [], disallow: [] };
          if (dis) groups[a].disallow.push(dis[1].trim());
          if (allow) groups[a].allow.push(allow[1].trim());
        }
      }
      const rules = groups[String(userAgent).toLowerCase()] ?? groups["*"] ?? { allow: [], disallow: [] };
      const matches = (patterns) =>
        patterns.filter((p) => p && path.startsWith(p.replace(/\*$/, ""))).sort((a, b) => b.length - a.length)[0] ?? null;
      const disMatch = matches(rules.disallow);
      const allowMatch = matches(rules.allow);
      const allowed = !disMatch || (allowMatch && allowMatch.length >= disMatch.length);
      return {
        origin: u.origin,
        robotsFound: true,
        userAgent,
        path,
        allowed: Boolean(allowed),
        matchedRule: disMatch ? `Disallow: ${disMatch}` : allowMatch ? `Allow: ${allowMatch}` : "no matching rule",
        sitemaps,
      };
    },
  },

  metadata: {
    price: 0.02,
    description:
      'Extract page metadata: title, description, Open Graph, Twitter card, canonical, favicon, language. POST {"url": "https://..."}.',
    output: { title: "string", description: "string", openGraph: {} },
    example: { url: "https://www.blixtworks.com" },
    run: async ({ url }) => {
      const u = safeUrl(url);
      const res = await fetch(u.toString(), {
        signal: AbortSignal.timeout(20000),
        headers: { ...UA, accept: "text/html,application/xhtml+xml" },
      });
      if (!res.ok) throw Object.assign(new Error(`fetch failed: ${res.status}`), { status: 422 });
      const html = (await res.text()).slice(0, 3_000_000);
      const meta = {};
      for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
        const tag = m[0];
        const key = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
        const val = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
        if (key && val != null) meta[key.toLowerCase()] = val;
      }
      const pick = (prefix) =>
        Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
      const icon = html.match(/<link\s+[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i)?.[0];
      return {
        url: u.toString(),
        title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
        description: meta.description ?? meta["og:description"] ?? null,
        language: html.match(/<html[^>]*lang\s*=\s*["']([^"']+)["']/i)?.[1] ?? null,
        canonical: html.match(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1] ?? null,
        favicon: icon ? new URL(icon.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? "/favicon.ico", u).toString() : `${u.origin}/favicon.ico`,
        openGraph: pick("og:"),
        twitter: pick("twitter:"),
      };
    },
  },

  ip_lookup: {
    price: 0.01,
    description:
      'Resolve a hostname to IPs and reverse-resolve. POST {"host": "example.com"} -> A/AAAA records and PTR names.',
    output: { addresses: [], reverse: [] },
    example: { host: "github.com" },
    run: async ({ host }) => {
      const h = safeDomain(host);
      const [v4, v6] = await Promise.all([
        dnsPromises.resolve4(h).catch(() => []),
        dnsPromises.resolve6(h).catch(() => []),
      ]);
      const addresses = [...v4, ...v6];
      const reverse = {};
      await Promise.all(
        addresses.slice(0, 5).map(async (ip) => {
          reverse[ip] = await dnsPromises.reverse(ip).catch(() => []);
        }),
      );
      return { host: h, addresses, ipv4: v4, ipv6: v6, reverse };
    },
  },

  email_validate: {
    price: 0.01,
    description:
      'Validate an email address: syntax plus live MX record check on the domain. POST {"email": "a@b.com"} -> deliverability signals.',
    output: { valid: true, hasMx: true, mxRecords: [] },
    example: { email: "hello@github.com" },
    run: async ({ email }) => {
      if (typeof email !== "string" || email.length > 320) {
        throw Object.assign(new Error("email is required"), { status: 400 });
      }
      const syntaxOk = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);
      const domain = email.split("@")[1]?.toLowerCase();
      let mx = [];
      if (syntaxOk && domain && !BLOCKED_HOSTS.test(domain)) {
        mx = await dnsPromises.resolveMx(domain).catch(() => []);
      }
      const disposable = /^(mailinator|guerrillamail|10minutemail|tempmail|throwaway|yopmail)\./i.test(domain ?? "");
      return {
        email,
        syntaxValid: syntaxOk,
        domain: domain ?? null,
        hasMx: mx.length > 0,
        mxRecords: mx.sort((a, b) => a.priority - b.priority).map((m) => `${m.exchange} (${m.priority})`),
        likelyDisposable: disposable,
        valid: syntaxOk && mx.length > 0,
      };
    },
  },
};

// --- carried over from the original toolbox ---

tools.md = {
  price: 0.02,
  description:
    'HTML to Markdown. POST {"url": "<https url>"} or {"html": "<raw html>"} (+ optional "mode": "article"|"full", default article) -> clean LLM-ready markdown with title/byline.',
  output: { markdown: "string", title: "string", byline: "string|null" },
  example: { url: "https://example.com", mode: "article" },
  run: async ({ url, html, mode = "article" }) => {
    const { JSDOM } = await import("jsdom");
    const TurndownService = (await import("turndown")).default;
    let source = html;
    if (!source) {
      const u = safeUrl(url);
      const res = await fetch(u, { signal: AbortSignal.timeout(25000), headers: UA });
      if (!res.ok) throw Object.assign(new Error(`fetch failed: ${res.status}`), { status: 422 });
      source = (await res.text()).slice(0, 10_000_000);
    }
    if (typeof source !== "string" || !source.length) {
      throw Object.assign(new Error("provide url or html"), { status: 400 });
    }
    const dom = new JSDOM(source, { url: url ?? "https://example.com/" });
    let title = dom.window.document.title || "";
    let byline = null;
    let contentHtml = dom.window.document.body?.innerHTML ?? source;
    if (mode !== "full") {
      const { Readability } = await import("@mozilla/readability");
      const article = new Readability(dom.window.document).parse();
      if (article?.content) {
        contentHtml = article.content;
        title = article.title || title;
        byline = article.byline ?? null;
      }
    }
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    return { markdown: turndown.turndown(contentHtml), title, byline };
  },
};

tools.dns = {
  price: 0.01,
  description:
    'DNS lookup. POST {"domain": "example.com", "type": "A"|"AAAA"|"MX"|"TXT"|"NS"|"CNAME"|"SOA"|"all"} -> resolved records.',
  output: { records: {} },
  example: { domain: "example.com", type: "all" },
  run: async ({ domain, type = "all" }) => {
    const host = safeDomain(domain);
    const TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA"];
    const wanted = type === "all" ? TYPES : [String(type).toUpperCase()];
    if (!wanted.every((t) => TYPES.includes(t))) {
      throw Object.assign(new Error(`type must be one of ${TYPES.join("/")} or all`), { status: 400 });
    }
    const records = {};
    await Promise.all(
      wanted.map(async (t) => {
        records[t] = await dnsPromises.resolve(host, t).catch(() => []);
      }),
    );
    return { domain: host, records };
  },
};
