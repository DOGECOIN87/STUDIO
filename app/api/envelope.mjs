/**
 * Audius Studio DAW API — response envelope and argument validation.
 *
 * Shaped after api-anything (github.com/DOGECOIN87/api-anything): every call
 * answers {"ok":true,"class":"ok","tier":1|3,"data":...,"ms":N}, and every
 * failure answers {"ok":false,"class":...,"reason":...,"next":...} so the
 * caller always knows what to try next. Classes are api-anything's:
 * ok | drift | auth | rate | blocked | input | error.
 *
 * Zero dependencies (Node >= 18).
 */

export const API_CLASSES = ["ok", "drift", "auth", "rate", "blocked", "input", "error"];

/** Tiers follow api-anything: 1 = plain HTTP on the server, 3 = the page itself ran it. */
export const TIER_SERVER = 1;
export const TIER_PAGE = 3;

export function okEnvelope(data, tier, ms, extra) {
  return { ok: true, class: "ok", tier, data, ms, ...(extra || {}) };
}

export function failEnvelope(cls, reason, next, { ms = 0, tier, status } = {}) {
  const out = { ok: false, class: API_CLASSES.includes(cls) ? cls : "error", reason, ms };
  if (next) out.next = next;
  if (tier) out.tier = tier;
  if (status) out.status = status;
  return out;
}

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function coerceOne(param, value) {
  switch (param.type || "string") {
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      }
      if (typeof value === "boolean") return value ? 1 : 0;
      return null;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (s === "true" || s === "1" || s === "on" || s === "yes") return true;
        if (s === "false" || s === "0" || s === "off" || s === "no") return false;
      }
      if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
      return null;
    }
    case "object": {
      if (isPlainObject(value)) return value;
      if (typeof value === "string" && value.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(value);
          return isPlainObject(parsed) ? parsed : null;
        } catch (_) {
          return null;
        }
      }
      return null;
    }
    case "array": {
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        const s = value.trim();
        if (s.startsWith("[")) {
          try {
            const parsed = JSON.parse(s);
            return Array.isArray(parsed) ? parsed : null;
          } catch (_) {
            return null;
          }
        }
        if (s !== "") return s.split(",").map((x) => x.trim()).filter((x) => x !== "");
      }
      return null;
    }
    default: {
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return null;
    }
  }
}

/**
 * Validate + coerce call args against an operation's param specs, api-anything
 * style (type, required, default, pattern, hint). Unknown args are refused so a
 * typo surfaces as an "input" failure instead of silently doing nothing.
 * An optional string param given as "" counts as not given, which keeps
 * hand-written api-anything specs (empty placeholder leaves) working.
 *
 * @returns {{ok:true,args:object}|{ok:false,reason:string,hint?:string}}
 */
export function coerceArgs(op, rawArgs) {
  const given = isPlainObject(rawArgs) ? rawArgs : {};
  const specs = Array.isArray(op.params) ? op.params : [];
  const known = new Set(specs.map((p) => p.name));
  const unknown = Object.keys(given).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `unknown param${unknown.length > 1 ? "s" : ""} ${unknown.map((u) => `"${u}"`).join(", ")} for operation "${op.name}"`,
      hint: `known params: ${specs.length ? specs.map((p) => p.name).join(", ") : "(none)"}`,
    };
  }

  const args = {};
  for (const param of specs) {
    let value = given[param.name];
    if (value === undefined || value === null || (param.type !== "string" && value === "")) {
      if (param.default !== undefined) {
        args[param.name] = param.default;
        continue;
      }
      if (param.required) {
        return {
          ok: false,
          reason: `missing required param "${param.name}" for operation "${op.name}"`,
          hint: param.hint || param.description || `${param.name}: ${param.type || "string"}`,
        };
      }
      continue;
    }
    // Optional params sent as the empty string are treated as absent (api-anything
    // spec bodies keep their placeholder leaf when an optional arg is not passed).
    if (value === "" && !param.required && (param.type || "string") === "string") continue;
    // Same for empty placeholder leaves of array/object params ("clipIds":[]).
    if (!param.required && Array.isArray(value) && value.length === 0) continue;
    if (!param.required && isPlainObject(value) && Object.keys(value).length === 0) continue;

    const coerced = coerceOne(param, value);
    if (coerced === null) {
      return {
        ok: false,
        reason: `param "${param.name}" must be ${param.type || "string"}, got ${JSON.stringify(value)}`,
        hint: param.hint || param.description,
      };
    }
    if (param.pattern !== undefined && !new RegExp(`^(?:${param.pattern})$`).test(String(coerced))) {
      return {
        ok: false,
        reason: `param "${param.name}" must be ${param.hint || `a value matching /${param.pattern}/`}, got ${JSON.stringify(value)}`,
        hint: param.hint,
      };
    }
    args[param.name] = coerced;
  }
  return { ok: true, args };
}

/** Load + sanity-check the catalog once at startup. */
export function validateCatalog(catalog) {
  const seen = new Set();
  for (const op of catalog.operations || []) {
    if (!op.name || typeof op.name !== "string") throw new Error("operation without a name");
    if (seen.has(op.name)) throw new Error(`duplicate operation name "${op.name}"`);
    seen.add(op.name);
    if (!["server", "page"].includes(op.executor)) throw new Error(`operation "${op.name}": executor must be "server" or "page"`);
    if (typeof op.readOnly !== "boolean") throw new Error(`operation "${op.name}": readOnly must be true or false`);
    for (const p of op.params || []) {
      if (!p.name) throw new Error(`operation "${op.name}": param without a name`);
      if (!["string", "number", "boolean", "object", "array"].includes(p.type || "string")) {
        throw new Error(`operation "${op.name}": param "${p.name}" has an unknown type`);
      }
      if (p.pattern !== undefined) new RegExp(p.pattern); // throws on a bad regex
    }
  }
  if (seen.size === 0) throw new Error("the catalog has no operations");
  return catalog;
}

export function tierFor(op) {
  return op.executor === "server" ? TIER_SERVER : TIER_PAGE;
}

/** An operation as callers see it in GET /api/operations. */
export function publicOperation(op) {
  return {
    name: op.name,
    description: op.description || "",
    readOnly: op.readOnly,
    tier: tierFor(op),
    executor: op.executor,
    params: (op.params || []).map((p) => ({
      name: p.name,
      type: p.type || "string",
      required: !!p.required,
      ...(p.description ? { description: p.description } : {}),
      ...(p.example !== undefined ? { example: p.example } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(p.pattern ? { pattern: p.pattern } : {}),
      ...(p.hint ? { hint: p.hint } : {}),
    })),
  };
}
