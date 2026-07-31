// Conversion, validation and calculation tools. Pure compute unless noted.
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error(`${name} must be a number`), { status: 400 });
  return n;
};

const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 },
  volume: { l: 1, ml: 0.001, m3: 1000, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625 },
  time: { s: 1, ms: 0.001, min: 60, h: 3600, d: 86400, wk: 604800, yr: 31557600 },
  area: { m2: 1, km2: 1e6, ha: 10000, ft2: 0.09290304, ac: 4046.8564224, mi2: 2589988.110336 },
  speed: { mps: 1, kmh: 0.277777778, mph: 0.44704, kn: 0.514444444 },
  data: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
  pressure: { pa: 1, kpa: 1000, bar: 100000, psi: 6894.757293, atm: 101325 },
  energy: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3600000 },
};

export const tools = {
  unit_convert: {
    price: 0.005,
    description:
      'Convert between units. POST {"value": 5, "from": "km", "to": "mi"} -> converted value. Supports length, mass, volume, time, area, speed, data, pressure, energy and temperature (c/f/k).',
    output: { result: 0, from: "string", to: "string" },
    example: { value: 42, from: "km", to: "mi" },
    run: ({ value, from, to }) => {
      const v = num(value, "value");
      const f = String(from ?? "").toLowerCase();
      const t = String(to ?? "").toLowerCase();
      const temp = { c: 1, f: 1, k: 1 };
      if (f in temp && t in temp) {
        const c = f === "c" ? v : f === "f" ? (v - 32) * (5 / 9) : v - 273.15;
        const out = t === "c" ? c : t === "f" ? c * (9 / 5) + 32 : c + 273.15;
        return { result: Number(out.toFixed(6)), from: f, to: t, category: "temperature" };
      }
      for (const [category, table] of Object.entries(UNITS)) {
        if (f in table && t in table) {
          return { result: Number(((v * table[f]) / table[t]).toFixed(9)), from: f, to: t, category };
        }
      }
      throw Object.assign(
        new Error(`cannot convert ${from} to ${to}. Supported: ${Object.values(UNITS).flatMap(Object.keys).join(", ")}, c, f, k`),
        { status: 400 },
      );
    },
  },

  number_base: {
    price: 0.005,
    description:
      'Convert a number between bases. POST {"value": "255", "from": 10, "to": 16} -> converted string (bases 2-36).',
    output: { result: "string" },
    example: { value: "255", from: 10, to: 16 },
    run: ({ value, from = 10, to = 16 }) => {
      const f = Math.min(Math.max(Number(from) || 10, 2), 36);
      const t = Math.min(Math.max(Number(to) || 16, 2), 36);
      const parsed = parseInt(String(value).trim(), f);
      if (Number.isNaN(parsed)) throw Object.assign(new Error("value is not valid in the source base"), { status: 400 });
      return { result: parsed.toString(t), decimal: parsed, from: f, to: t };
    },
  },

  color_convert: {
    price: 0.005,
    description:
      'Convert colours between hex, RGB and HSL. POST {"color": "#2563eb"} -> hex, rgb, hsl and luminance/contrast info.',
    output: { hex: "string", rgb: {}, hsl: {} },
    example: { color: "#2563eb" },
    run: ({ color }) => {
      if (typeof color !== "string") throw Object.assign(new Error("color is required"), { status: 400 });
      let r;
      let g;
      let b;
      const hex = color.trim().replace(/^#/, "");
      const rgbMatch = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
      if (/^[0-9a-f]{3}$/i.test(hex)) {
        [r, g, b] = hex.split("").map((c) => parseInt(c + c, 16));
      } else if (/^[0-9a-f]{6}$/i.test(hex)) {
        [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      } else if (rgbMatch) {
        [r, g, b] = rgbMatch.slice(1, 4).map(Number);
      } else {
        throw Object.assign(new Error("unrecognised colour (use #hex or rgb())"), { status: 400 });
      }
      if ([r, g, b].some((c) => c < 0 || c > 255)) throw Object.assign(new Error("channel out of range"), { status: 400 });
      const [rn, gn, bn] = [r / 255, g / 255, b / 255];
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
        h *= 60;
      }
      const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const lum = 0.2126 * lin(rn) + 0.7152 * lin(gn) + 0.0722 * lin(bn);
      return {
        hex: `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
        rgb: { r, g, b },
        hsl: { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) },
        luminance: Number(lum.toFixed(4)),
        contrastWithWhite: Number(((1.05) / (lum + 0.05)).toFixed(2)),
        contrastWithBlack: Number(((lum + 0.05) / 0.05).toFixed(2)),
      };
    },
  },

  timestamp: {
    price: 0.005,
    description:
      'Convert timestamps and dates. POST {"value": 1735689600, "timezone": "Europe/Stockholm"} or {"value": "2026-01-01T00:00:00Z"} -> unix seconds/ms, ISO, and formatted local time.',
    output: { unix: 0, iso: "string", formatted: "string" },
    example: { value: "2026-01-01T00:00:00Z", timezone: "Europe/Stockholm" },
    run: ({ value, timezone = "UTC" }) => {
      let date;
      if (value == null) date = new Date();
      else if (typeof value === "number" || /^\d{9,13}$/.test(String(value))) {
        const n = Number(value);
        date = new Date(String(value).length > 10 ? n : n * 1000);
      } else date = new Date(String(value));
      if (Number.isNaN(date.getTime())) throw Object.assign(new Error("unparseable date"), { status: 400 });
      let formatted;
      try {
        formatted = new Intl.DateTimeFormat("sv-SE", {
          timeZone: timezone, dateStyle: "full", timeStyle: "long",
        }).format(date);
      } catch {
        throw Object.assign(new Error(`unknown timezone: ${timezone}`), { status: 400 });
      }
      return {
        unix: Math.floor(date.getTime() / 1000),
        unixMs: date.getTime(),
        iso: date.toISOString(),
        utc: date.toUTCString(),
        formatted,
        timezone,
        dayOfWeek: new Intl.DateTimeFormat("en", { weekday: "long", timeZone: timezone }).format(date),
      };
    },
  },

  date_diff: {
    price: 0.005,
    description:
      'Difference between two dates. POST {"from": "2026-01-01", "to": "2026-12-25"} -> days, hours, business days and a human summary.',
    output: { days: 0, humanized: "string" },
    example: { from: "2026-01-01", to: "2026-12-25" },
    run: ({ from, to }) => {
      const a = new Date(from ?? Date.now());
      const b = new Date(to ?? Date.now());
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
        throw Object.assign(new Error("unparseable date"), { status: 400 });
      }
      const ms = Math.abs(b - a);
      const days = Math.floor(ms / 86400000);
      let business = 0;
      const step = new Date(Math.min(a, b));
      const end = new Date(Math.max(a, b));
      while (step < end && business < 100000) {
        const d = step.getUTCDay();
        if (d !== 0 && d !== 6) business++;
        step.setUTCDate(step.getUTCDate() + 1);
      }
      const years = Math.floor(days / 365.25);
      const months = Math.floor((days % 365.25) / 30.44);
      return {
        milliseconds: ms,
        seconds: Math.floor(ms / 1000),
        minutes: Math.floor(ms / 60000),
        hours: Math.floor(ms / 3600000),
        days,
        weeks: Number((days / 7).toFixed(2)),
        businessDays: business,
        humanized: [years && `${years}y`, months && `${months}mo`, `${days % 30}d`].filter(Boolean).join(" "),
        future: b > a,
      };
    },
  },

  cron_parse: {
    price: 0.01,
    description:
      'Explain a cron expression and list upcoming run times. POST {"expression": "0 9 * * 1-5", "count": 5, "timezone": "UTC"}.',
    output: { next: ["iso"], description: "string" },
    example: { expression: "0 9 * * 1-5", count: 3 },
    run: async ({ expression, count = 5, timezone = "UTC" }) => {
      if (typeof expression !== "string" || !expression.trim()) {
        throw Object.assign(new Error("expression is required"), { status: 400 });
      }
      const mod = await import("cron-parser");
      const parser = mod.default ?? mod;
      const n = Math.min(Math.max(Number(count) || 5, 1), 50);
      try {
        const it = (parser.parseExpression ?? parser.CronExpressionParser?.parse).call(
          parser.parseExpression ? parser : parser.CronExpressionParser,
          expression,
          { tz: timezone },
        );
        const next = [];
        for (let i = 0; i < n; i++) next.push(it.next().toISOString());
        return { expression, timezone, next, count: next.length };
      } catch (e) {
        throw Object.assign(new Error(`invalid cron expression: ${e.message}`), { status: 400 });
      }
    },
  },

  distance: {
    price: 0.005,
    description:
      'Great-circle distance between two coordinates. POST {"from": {"lat": 59.33, "lon": 18.07}, "to": {"lat": 51.51, "lon": -0.13}} -> km, miles and bearing.',
    output: { kilometers: 0, miles: 0, bearing: 0 },
    example: { from: { lat: 59.3293, lon: 18.0686 }, to: { lat: 51.5074, lon: -0.1278 } },
    run: ({ from, to }) => {
      const get = (p, name) => {
        const lat = num(p?.lat ?? p?.latitude, `${name}.lat`);
        const lon = num(p?.lon ?? p?.lng ?? p?.longitude, `${name}.lon`);
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          throw Object.assign(new Error(`${name} out of range`), { status: 400 });
        }
        return [lat, lon];
      };
      const [lat1, lon1] = get(from, "from");
      const [lat2, lon2] = get(to, "to");
      const R = 6371;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const km = 2 * R * Math.asin(Math.sqrt(a));
      const y = Math.sin(dLon) * Math.cos(toRad(lat2));
      const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
      return {
        kilometers: Number(km.toFixed(3)),
        miles: Number((km * 0.621371).toFixed(3)),
        nauticalMiles: Number((km * 0.539957).toFixed(3)),
        bearing: Number((((Math.atan2(y, x) * 180) / Math.PI + 360) % 360).toFixed(1)),
      };
    },
  },

  currency_convert: {
    price: 0.02,
    description:
      'Convert currency at current or historical reference rates (ECB via Frankfurter). POST {"amount": 100, "from": "EUR", "to": "SEK", "date": "2026-01-15"}.',
    output: { result: 0, rate: 0, date: "string" },
    example: { amount: 100, from: "EUR", to: "SEK" },
    run: async ({ amount = 1, from = "EUR", to = "USD", date }) => {
      const a = num(amount, "amount");
      const f = String(from).toUpperCase();
      const t = String(to).toUpperCase();
      if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) {
        throw Object.assign(new Error("from/to must be 3-letter currency codes"), { status: 400 });
      }
      const when = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
      const res = await fetch(`https://api.frankfurter.dev/v1/${when}?base=${f}&symbols=${t}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw Object.assign(new Error(`rate lookup failed (${res.status}) — check currency codes`), { status: 422 });
      const d = await res.json();
      const rate = d.rates?.[t];
      if (rate == null) throw Object.assign(new Error(`no rate for ${f}->${t}`), { status: 422 });
      return {
        amount: a, from: f, to: t, rate,
        result: Number((a * rate).toFixed(4)),
        date: d.date,
        source: "European Central Bank reference rates",
      };
    },
  },

  luhn_validate: {
    price: 0.005,
    description:
      'Validate an identifier with the Luhn checksum (credit cards, IMEI, Swedish personnummer). POST {"number": "4111111111111111"} -> validity and detected card scheme.',
    output: { valid: true, scheme: "string" },
    example: { number: "4111111111111111" },
    run: ({ number }) => {
      const digits = String(number ?? "").replace(/[\s-]/g, "");
      if (!/^\d{6,25}$/.test(digits)) throw Object.assign(new Error("number must be 6-25 digits"), { status: 400 });
      let sum = 0;
      let alt = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let d = Number(digits[i]);
        if (alt) {
          d *= 2;
          if (d > 9) d -= 9;
        }
        sum += d;
        alt = !alt;
      }
      const schemes = [
        [/^4\d{12}(\d{3})?$/, "Visa"],
        [/^5[1-5]\d{14}$/, "Mastercard"],
        [/^3[47]\d{13}$/, "American Express"],
        [/^6(?:011|5\d{2})\d{12}$/, "Discover"],
        [/^3(?:0[0-5]|[68]\d)\d{11}$/, "Diners Club"],
        [/^\d{15}$/, "IMEI"],
      ];
      return {
        valid: sum % 10 === 0,
        length: digits.length,
        scheme: schemes.find(([re]) => re.test(digits))?.[1] ?? null,
      };
    },
  },

  phone_parse: {
    price: 0.01,
    description:
      'Parse and validate a phone number. POST {"phone": "+46701234567", "country": "SE"} -> validity, type, and E.164/national/international formats.',
    output: { valid: true, e164: "string", country: "string" },
    example: { phone: "+46 70 123 45 67" },
    run: async ({ phone, country }) => {
      if (typeof phone !== "string" || !phone.trim()) {
        throw Object.assign(new Error("phone is required"), { status: 400 });
      }
      const { parsePhoneNumberFromString } = await import("libphonenumber-js");
      const parsed = parsePhoneNumberFromString(phone, country ? String(country).toUpperCase() : undefined);
      if (!parsed) return { valid: false, reason: "could not parse — try supplying country (e.g. SE)" };
      return {
        valid: parsed.isValid(),
        possible: parsed.isPossible(),
        e164: parsed.number,
        international: parsed.formatInternational(),
        national: parsed.formatNational(),
        country: parsed.country ?? null,
        countryCallingCode: parsed.countryCallingCode,
        type: parsed.getType() ?? null,
      };
    },
  },

  iban_validate: {
    price: 0.005,
    description: 'Validate an IBAN (checksum and country length). POST {"iban": "SE45 5000 0000 0583 9825 7466"}.',
    output: { valid: true, country: "string" },
    example: { iban: "SE4550000000058398257466" },
    run: ({ iban }) => {
      const clean = String(iban ?? "").replace(/\s/g, "").toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(clean)) {
        return { valid: false, reason: "malformed IBAN" };
      }
      const lengths = { SE: 24, NO: 15, DK: 18, FI: 18, DE: 22, GB: 22, FR: 27, ES: 24, IT: 27, NL: 18, PL: 28, IE: 22, PT: 25, BE: 16, AT: 20, CH: 21 };
      const country = clean.slice(0, 2);
      const expected = lengths[country];
      const rearranged = clean.slice(4) + clean.slice(0, 4);
      const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
      let remainder = 0;
      for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
      return {
        valid: remainder === 1 && (!expected || clean.length === expected),
        country,
        length: clean.length,
        expectedLength: expected ?? null,
        checksumOk: remainder === 1,
        formatted: clean.replace(/(.{4})/g, "$1 ").trim(),
      };
    },
  },

  percentage: {
    price: 0.005,
    description:
      'Percentage maths. POST {"mode": "change"|"of"|"increase"|"decrease", "a": 120, "b": 150} -> result with explanation.',
    output: { result: 0, explanation: "string" },
    example: { mode: "change", a: 120, b: 150 },
    run: ({ mode = "change", a, b }) => {
      const x = num(a, "a");
      const y = num(b, "b");
      switch (mode) {
        case "of":
          return { result: Number(((x / 100) * y).toFixed(6)), explanation: `${x}% of ${y}` };
        case "increase":
          return { result: Number((y * (1 + x / 100)).toFixed(6)), explanation: `${y} increased by ${x}%` };
        case "decrease":
          return { result: Number((y * (1 - x / 100)).toFixed(6)), explanation: `${y} decreased by ${x}%` };
        case "change": {
          if (x === 0) throw Object.assign(new Error("a cannot be zero for change"), { status: 400 });
          const pct = ((y - x) / x) * 100;
          return {
            result: Number(pct.toFixed(4)),
            explanation: `${x} → ${y} is a ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% change`,
            direction: pct >= 0 ? "increase" : "decrease",
          };
        }
        default:
          throw Object.assign(new Error("mode must be change, of, increase or decrease"), { status: 400 });
      }
    },
  },
};
