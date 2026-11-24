var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// constants.js
var SCHEMA_VERSION = "v7";
var PREVIOUS_SCHEMA_VERSION = "v6";
var HOME_CACHE_VERSION = "v43";
var HOME_CACHE_TTL = 21600;
var DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  desc TEXT,
  catelog_id INTEGER NOT NULL,
  catelog_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  is_private INTEGER DEFAULT 0,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  desc TEXT,
  catelog_id INTEGER NOT NULL,
  catelog_name TEXT,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catelog TEXT  NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  parent_id INTEGER DEFAULT 0,
  is_private INTEGER DEFAULT 0,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_sites_catelog_id ON sites(catelog_id);
CREATE INDEX IF NOT EXISTS idx_sites_sort_order ON sites(sort_order);
CREATE INDEX IF NOT EXISTS idx_sites_private_sort ON sites(is_private, sort_order);
CREATE INDEX IF NOT EXISTS idx_sites_catelog_name ON sites(catelog_name);
CREATE INDEX IF NOT EXISTS idx_sites_url ON sites(url);
`;
var FONT_MAP = {
  // System Fonts (无需引入)
  "sans-serif": null,
  "serif": null,
  "monospace": null,
  "'Microsoft YaHei', sans-serif": null,
  "'SimSun', serif": null,
  "'PingFang SC', sans-serif": null,
  "'Segoe UI', sans-serif": null,
  // Web Fonts (fonts.loli.net)
  "'Noto Sans SC', sans-serif": "https://fonts.loli.net/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap",
  "'Noto Serif SC', serif": "https://fonts.loli.net/css2?family=Noto+Serif+SC:wght@400;700&display=swap",
  "'Ma Shan Zheng', cursive": "https://fonts.loli.net/css2?family=Ma+Shan+Zheng&display=swap",
  // 书法
  "'ZCOOL KuaiLe', cursive": "https://fonts.loli.net/css2?family=ZCOOL+KuaiLe&display=swap",
  // 快乐体
  "'Long Cang', cursive": "https://fonts.loli.net/css2?family=Long+Cang&display=swap",
  // 草书
  "'Roboto', sans-serif": "https://fonts.loli.net/css2?family=Roboto:wght@300;400;500;700&display=swap",
  "'Open Sans', sans-serif": "https://fonts.loli.net/css2?family=Open+Sans:wght@400;600;700&display=swap",
  "'Lato', sans-serif": "https://fonts.loli.net/css2?family=Lato:wght@400;700&display=swap",
  "'Montserrat', sans-serif": "https://fonts.loli.net/css2?family=Montserrat:wght@400;700&display=swap"
};

// lib/schema-migration.js
var schemaReady = false;
var schemaReadyPromise = null;
var PRIVACY_GUARD_TRIGGER_STATEMENTS = [
  `CREATE TRIGGER IF NOT EXISTS trg_privacy_category_insert
  BEFORE INSERT ON category
  WHEN COALESCE(NEW.is_private, 0) = 0
    AND NEW.parent_id IS NOT NULL
    AND NEW.parent_id != 0
    AND EXISTS (
      SELECT 1 FROM category
      WHERE id = NEW.parent_id AND COALESCE(is_private, 0) = 1
    )
  BEGIN
    SELECT RAISE(ABORT, 'privacy_guard_private_parent');
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_privacy_category_update
  BEFORE UPDATE OF is_private, parent_id ON category
  WHEN COALESCE(NEW.is_private, 0) = 0
    AND NEW.parent_id IS NOT NULL
    AND NEW.parent_id != 0
    AND EXISTS (
      SELECT 1 FROM category
      WHERE id = NEW.parent_id AND COALESCE(is_private, 0) = 1
    )
  BEGIN
    SELECT RAISE(ABORT, 'privacy_guard_private_parent');
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_privacy_site_insert
  BEFORE INSERT ON sites
  WHEN COALESCE(NEW.is_private, 0) = 0
    AND EXISTS (
      SELECT 1 FROM category
      WHERE id = NEW.catelog_id AND COALESCE(is_private, 0) = 1
    )
  BEGIN
    SELECT RAISE(ABORT, 'privacy_guard_private_category');
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_privacy_site_update
  BEFORE UPDATE OF is_private, catelog_id ON sites
  WHEN COALESCE(NEW.is_private, 0) = 0
    AND EXISTS (
      SELECT 1 FROM category
      WHERE id = NEW.catelog_id AND COALESCE(is_private, 0) = 1
    )
  BEGIN
    SELECT RAISE(ABORT, 'privacy_guard_private_category');
  END`
];
var PRIVACY_GUARD_REPAIR_STATEMENTS = [
  `WITH RECURSIVE private_categories(id) AS (
    SELECT id FROM category WHERE COALESCE(is_private, 0) = 1
    UNION
    SELECT c.id
    FROM category c
    INNER JOIN private_categories p ON c.parent_id = p.id
  )
  UPDATE category
  SET is_private = 1
  WHERE id IN (SELECT id FROM private_categories)
    AND COALESCE(is_private, 0) = 0`,
  `UPDATE sites
  SET is_private = 1
  WHERE COALESCE(is_private, 0) = 0
    AND EXISTS (
      SELECT 1 FROM category
      WHERE category.id = sites.catelog_id
        AND COALESCE(category.is_private, 0) = 1
    )`
];
var CATEGORY_CYCLE_GUARD_ERROR = "category_cycle_guard";
var cycleGuardBody = /* @__PURE__ */ __name((event) => `CREATE TRIGGER trg_category_no_cycle_${event.toLowerCase()}
  BEFORE ${event === "UPDATE" ? "UPDATE OF parent_id" : event} ON category
  WHEN NEW.parent_id IS NOT NULL
    AND NEW.parent_id != 0
    ${event === "INSERT" ? "AND NEW.id > 0" : ""}
    AND EXISTS (
      WITH RECURSIVE ancestors(id) AS (
        SELECT NEW.parent_id
        UNION
        SELECT c.parent_id FROM category c
        INNER JOIN ancestors a ON c.id = a.id
        WHERE c.parent_id IS NOT NULL AND c.parent_id != 0
      )
      SELECT 1 FROM ancestors WHERE id = NEW.id
        OR NOT EXISTS (
          SELECT 1 FROM ancestors a
          LEFT JOIN category c ON c.id = a.id
          WHERE c.id IS NULL OR c.parent_id IS NULL OR c.parent_id = 0
        )
    )
  BEGIN
    SELECT RAISE(ABORT, '${CATEGORY_CYCLE_GUARD_ERROR}');
  END`, "cycleGuardBody");
var CATEGORY_CYCLE_GUARD_TRIGGER_NAMES = [
  "trg_category_no_cycle_update",
  "trg_category_no_cycle_insert"
];
var CATEGORY_CYCLE_GUARD_TRIGGER_STATEMENTS = [
  "DROP TRIGGER IF EXISTS trg_category_no_cycle_update",
  "DROP TRIGGER IF EXISTS trg_category_no_cycle_insert",
  cycleGuardBody("UPDATE"),
  cycleGuardBody("INSERT")
];
async function runBaseSchema(db) {
  const statements = DB_SCHEMA.split(";").map((stmt) => stmt.trim()).filter(Boolean).map((stmt) => db.prepare(stmt));
  if (statements.length > 0) {
    await db.batch(statements);
  }
}
__name(runBaseSchema, "runBaseSchema");
async function runIncrementalMigrations(env) {
  await env.NAV_DB.batch([
    env.NAV_DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_catelog_id ON sites(catelog_id)"),
    env.NAV_DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_sort_order ON sites(sort_order)"),
    env.NAV_DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_private_sort ON sites(is_private, sort_order)"),
    env.NAV_DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_catelog_name ON sites(catelog_name)"),
    env.NAV_DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_url ON sites(url)")
  ]);
  const [sitesColumns, categoryColumns, pendingColumns] = await Promise.all([
    env.NAV_DB.prepare("PRAGMA table_info(sites)").all(),
    env.NAV_DB.prepare("PRAGMA table_info(category)").all(),
    env.NAV_DB.prepare("PRAGMA table_info(pending_sites)").all()
  ]);
  const sitesCols = new Set((sitesColumns.results || []).map((column) => column.name));
  const categoryCols = new Set((categoryColumns.results || []).map((column) => column.name));
  const pendingCols = new Set((pendingColumns.results || []).map((column) => column.name));
  const alterStatements = [];
  const sitesMissingCatalogName = !sitesCols.has("catelog_name");
  const pendingMissingCatalogName = !pendingCols.has("catelog_name");
  if (!sitesCols.has("is_private")) {
    alterStatements.push(env.NAV_DB.prepare("ALTER TABLE sites ADD COLUMN is_private INTEGER DEFAULT 0"));
  }
  if (sitesMissingCatalogName) {
    alterStatements.push(env.NAV_DB.prepare("ALTER TABLE sites ADD COLUMN catelog_name TEXT"));
  }
  if (pendingMissingCatalogName) {
    alterStatements.push(env.NAV_DB.prepare("ALTER TABLE pending_sites ADD COLUMN catelog_name TEXT"));
  }
  if (!categoryCols.has("is_private")) {
    alterStatements.push(env.NAV_DB.prepare("ALTER TABLE category ADD COLUMN is_private INTEGER DEFAULT 0"));
  }
  if (!categoryCols.has("parent_id")) {
    alterStatements.push(env.NAV_DB.prepare("ALTER TABLE category ADD COLUMN parent_id INTEGER DEFAULT 0"));
  }
  for (const statement of alterStatements) {
    try {
      await statement.run();
    } catch (error) {
      console.warn("Schema alter skipped:", error.message);
    }
  }
  if (sitesMissingCatalogName) {
    await env.NAV_DB.prepare(`
      UPDATE sites
      SET catelog_name = (
        SELECT catelog FROM category WHERE category.id = sites.catelog_id
      )
      WHERE catelog_name IS NULL
    `).run();
  }
  if (pendingMissingCatalogName) {
    await env.NAV_DB.prepare(`
      UPDATE pending_sites
      SET catelog_name = (
        SELECT catelog FROM category WHERE category.id = pending_sites.catelog_id
      )
      WHERE catelog_name IS NULL
    `).run();
  }
  await env.NAV_DB.batch(
    [
      ...PRIVACY_GUARD_REPAIR_STATEMENTS,
      ...PRIVACY_GUARD_TRIGGER_STATEMENTS,
      ...CATEGORY_CYCLE_GUARD_TRIGGER_STATEMENTS
    ].map((sql) => env.NAV_DB.prepare(sql))
  );
  const cycleGuards = await env.NAV_DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('trg_category_no_cycle_update', 'trg_category_no_cycle_insert')").all();
  const guardRows = cycleGuards?.results || [];
  const guardNames = new Set(guardRows.map((row) => row.name));
  const guardDefinitionOk = guardRows.length === CATEGORY_CYCLE_GUARD_TRIGGER_NAMES.length && CATEGORY_CYCLE_GUARD_TRIGGER_NAMES.every((name) => guardNames.has(name)) && guardRows.every((row) => String(row.sql || "").includes(CATEGORY_CYCLE_GUARD_ERROR));
  if (!guardDefinitionOk) {
    throw new Error("category cycle guard triggers missing or stale after migration");
  }
}
__name(runIncrementalMigrations, "runIncrementalMigrations");
async function ensureSchemaReady(env) {
  if (!env || !env.NAV_DB) return;
  if (schemaReady) return;
  if (schemaReadyPromise) {
    await schemaReadyPromise;
    return;
  }
  schemaReadyPromise = (async () => {
    const kv = env.NAV_AUTH;
    if (kv) {
      try {
        const migrated = await kv.get(`schema_migrated_${SCHEMA_VERSION}`);
        if (migrated) {
          schemaReady = true;
          return;
        }
      } catch (error) {
        console.warn("Schema version check failed:", error);
      }
    }
    try {
      await runBaseSchema(env.NAV_DB);
      await runIncrementalMigrations(env);
      if (kv) {
        await kv.put(`schema_migrated_${SCHEMA_VERSION}`, "true");
        if (PREVIOUS_SCHEMA_VERSION && PREVIOUS_SCHEMA_VERSION !== SCHEMA_VERSION) {
          try {
            await kv.delete(`schema_migrated_${PREVIOUS_SCHEMA_VERSION}`);
          } catch (cleanupError) {
            console.warn("Previous schema marker cleanup failed:", cleanupError);
          }
        }
      }
      schemaReady = true;
    } catch (error) {
      console.error("Schema migration failed:", error);
    }
  })().finally(() => {
    schemaReadyPromise = null;
  });
  await schemaReadyPromise;
}
__name(ensureSchemaReady, "ensureSchemaReady");

// lib/utils.js
var ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}
__name(escapeHTML, "escapeHTML");
function sanitizeUrl(url) {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.href;
  } catch {
    return "";
  }
}
__name(sanitizeUrl, "sanitizeUrl");
function getUrlAuthority(parsed) {
  const auth = parsed.username || parsed.password ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@` : "";
  return `${parsed.protocol}//${auth}${parsed.host}`;
}
__name(getUrlAuthority, "getUrlAuthority");
function normalizeUrlForStorage(url) {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return "";
  try {
    const parsed = new URL(safeUrl);
    if (parsed.pathname === "/") {
      return `${getUrlAuthority(parsed)}${parsed.search}${parsed.hash}`;
    }
    return parsed.href;
  } catch {
    return "";
  }
}
__name(normalizeUrlForStorage, "normalizeUrlForStorage");
function getUrlMatchCandidates(url) {
  const rawUrl = String(url ?? "").trim();
  const normalizedUrl = normalizeUrlForStorage(rawUrl);
  if (!normalizedUrl) return [];
  const candidates = /* @__PURE__ */ new Set([normalizedUrl]);
  const safeUrl = sanitizeUrl(rawUrl);
  if (safeUrl) candidates.add(safeUrl);
  if (rawUrl) candidates.add(rawUrl);
  try {
    const parsed = new URL(safeUrl || normalizedUrl);
    if (parsed.pathname === "/") {
      const authority = getUrlAuthority(parsed);
      candidates.add(`${authority}${parsed.search}${parsed.hash}`);
      candidates.add(`${authority}/${parsed.search}${parsed.hash}`);
    } else {
      const base = `${getUrlAuthority(parsed)}${parsed.pathname.replace(/\/$/, "")}`;
      candidates.add(`${base}${parsed.search}${parsed.hash}`);
      candidates.add(`${base}/${parsed.search}${parsed.hash}`);
    }
  } catch {
  }
  return [...candidates].filter(Boolean);
}
__name(getUrlMatchCandidates, "getUrlMatchCandidates");
function sanitizeStyleSize(size, options = {}) {
  if (size === null || size === void 0 || size === "") return "";
  const min = options.min ?? 8;
  const max = options.max ?? 96;
  const value = Number(String(size).trim());
  if (!Number.isFinite(value) || value < min || value > max) return "";
  return String(Math.round(value * 100) / 100);
}
__name(sanitizeStyleSize, "sanitizeStyleSize");
function sanitizeStyleColor(color) {
  if (!color) return "";
  const value = String(color).trim();
  if (!value) return "";
  const lowerValue = value.toLowerCase();
  if (lowerValue === "undefined" || lowerValue === "null") return "";
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    return value;
  }
  if (/^[a-z][a-z0-9-]{0,31}$/i.test(value)) {
    return value;
  }
  const rgbMatch = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i);
  if (!rgbMatch) return "";
  const channels = rgbMatch.slice(1, 4).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) return "";
  if (value.toLowerCase().startsWith("rgba") && rgbMatch[4] === void 0) return "";
  return value;
}
__name(sanitizeStyleColor, "sanitizeStyleColor");
function parsePagination(searchParams, options = {}) {
  const defaultPage = options.defaultPage ?? 1;
  const defaultPageSize = options.defaultPageSize ?? 10;
  const maxPageSize = options.maxPageSize ?? 200;
  const requestedPage = parseInt(searchParams.get("page") || String(defaultPage), 10);
  const requestedPageSize = parseInt(searchParams.get("pageSize") || String(defaultPageSize), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : defaultPage;
  const rawPageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : defaultPageSize;
  const pageSize = Math.min(rawPageSize, maxPageSize);
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
}
__name(parsePagination, "parsePagination");
function normalizeSortOrder(val) {
  const num = Number(val);
  return Number.isFinite(num) ? num : 9999;
}
__name(normalizeSortOrder, "normalizeSortOrder");
function escapeLikePattern(str) {
  return String(str).replace(/[%_\\]/g, (c) => "\\" + c);
}
__name(escapeLikePattern, "escapeLikePattern");
function buildFaviconUrl(siteUrl, currentLogo, iconAPI) {
  if (currentLogo && !currentLogo.startsWith("data:image")) return currentLogo;
  if (!siteUrl || !(siteUrl.startsWith("https://") || siteUrl.startsWith("http://"))) return currentLogo || null;
  try {
    const domain = new URL(siteUrl).host;
    return `${iconAPI}${domain}`;
  } catch {
    return currentLogo || null;
  }
}
__name(buildFaviconUrl, "buildFaviconUrl");
function getStyleStr(size, color, font) {
  let s = "";
  const safeSize = sanitizeStyleSize(size);
  const safeColor = sanitizeStyleColor(color);
  if (safeSize) s += `font-size: ${safeSize}px;`;
  if (safeColor) s += `color: ${safeColor} !important;`;
  if (font && font in FONT_MAP) s += `font-family: ${font} !important;`;
  return s ? `style="${s}"` : "";
}
__name(getStyleStr, "getStyleStr");

// _middleware.js
var GRAPH_CACHE_GENERATION_KEY = "graph_cache_generation";
var SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "frame-ancestors 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};
var HSTS_HEADER = "max-age=31536000";
function withSecurityHeaders(response, requestUrl) {
  const isHttps = new URL(requestUrl).protocol === "https:";
  const alreadyComplete = Object.keys(SECURITY_HEADERS).every((name) => response.headers.has(name)) && (!isHttps || response.headers.has("Strict-Transport-Security"));
  if (alreadyComplete) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) {
      secured.headers.set(name, value);
    }
  }
  if (isHttps && !secured.headers.has("Strict-Transport-Security")) {
    secured.headers.set("Strict-Transport-Security", HSTS_HEADER);
  }
  return secured;
}
__name(withSecurityHeaders, "withSecurityHeaders");
function isSubmissionEnabled(env) {
  return String(env.ENABLE_PUBLIC_SUBMISSION) === "true";
}
__name(isSubmissionEnabled, "isSubmissionEnabled");
async function isAdminAuthenticated(request, env) {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return false;
  const match2 = cookie.match(/admin_session=([^;]+)/);
  if (!match2) return false;
  const token = match2[1];
  const session = await env.NAV_AUTH.get(`session_${token}`);
  return Boolean(session);
}
__name(isAdminAuthenticated, "isAdminAuthenticated");
function errorResponse(message, status) {
  return new Response(JSON.stringify({ code: status, message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
__name(errorResponse, "errorResponse");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
__name(jsonResponse, "jsonResponse");
function getHomeCacheKey(scope, generation = null) {
  const key = `home_html_${scope}_${HOME_CACHE_VERSION}`;
  return generation === null ? key : `${key}_${generation}`;
}
__name(getHomeCacheKey, "getHomeCacheKey");
function getHomeDirtyKey(scope) {
  return `home_dirty_${scope}_${HOME_CACHE_VERSION}`;
}
__name(getHomeDirtyKey, "getHomeDirtyKey");
async function getHomeCacheDirtyValue(env, scope) {
  try {
    return await env.NAV_AUTH.get(getHomeDirtyKey(scope));
  } catch (e) {
    console.error("Failed to read home cache dirty value:", e);
    throw e;
  }
}
__name(getHomeCacheDirtyValue, "getHomeCacheDirtyValue");
async function clearHomeCache(env, scope = "all") {
  try {
    const keys = [];
    const generation = env.NAV_DB ? await getGraphCacheGeneration(env) : null;
    if (env.NAV_DB && generation === null) {
      throw new Error("Failed to read cache generation");
    }
    if (scope === "all" || scope === "public") {
      keys.push(getHomeCacheKey("public"));
      if (generation !== null) keys.push(getHomeCacheKey("public", generation));
    }
    if (scope === "all" || scope === "private") {
      keys.push(getHomeCacheKey("private"));
      if (generation !== null) keys.push(getHomeCacheKey("private", generation));
    }
    await Promise.all(keys.map((key) => env.NAV_AUTH.delete(key)));
  } catch (e) {
    console.error("Failed to clear home cache:", e);
    throw e;
  }
}
__name(clearHomeCache, "clearHomeCache");
async function clearGraphCache(env, { throwOnError = false } = {}) {
  const generation = crypto.randomUUID();
  if (env?.NAV_DB && typeof env.NAV_DB.prepare === "function") {
    try {
      await env.NAV_DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(GRAPH_CACHE_GENERATION_KEY, generation).run();
    } catch (e) {
      console.warn("Failed to clear graph cache:", e);
      if (throwOnError) throw e;
    }
    return;
  }
  if (!env?.NAV_AUTH || typeof env.NAV_AUTH.put !== "function") return;
  try {
    await env.NAV_AUTH.put(GRAPH_CACHE_GENERATION_KEY, generation);
  } catch (e) {
    console.warn("Failed to clear graph cache:", e);
    if (throwOnError) throw e;
  }
}
__name(clearGraphCache, "clearGraphCache");
async function getGraphCacheGeneration(env) {
  if (env?.NAV_DB && typeof env.NAV_DB.prepare === "function") {
    try {
      const result = await env.NAV_DB.prepare("SELECT value FROM settings WHERE key = ?").bind(GRAPH_CACHE_GENERATION_KEY).first();
      return result?.value || "0";
    } catch (e) {
      console.warn("Failed to read graph cache generation:", e);
      return null;
    }
  }
  if (!env?.NAV_AUTH || typeof env.NAV_AUTH.get !== "function") return null;
  try {
    return await env.NAV_AUTH.get(GRAPH_CACHE_GENERATION_KEY) || "0";
  } catch (e) {
    console.warn("Failed to read graph cache generation:", e);
    return null;
  }
}
__name(getGraphCacheGeneration, "getGraphCacheGeneration");
async function markHomeCacheDirty(env, scope = "all") {
  await clearGraphCache(env);
  try {
    const keys = [];
    const dirtyValue = crypto.randomUUID();
    if (scope === "all" || scope === "public") {
      keys.push(getHomeDirtyKey("public"));
    }
    if (scope === "all" || scope === "private") {
      keys.push(getHomeDirtyKey("private"));
    }
    await Promise.all(
      keys.map((key) => env.NAV_AUTH.put(key, dirtyValue, { expirationTtl: HOME_CACHE_TTL }))
    );
  } catch (e) {
    console.error("Failed to mark home cache dirty:", e);
    try {
      await clearHomeCache(env, scope);
    } catch (cacheError) {
      console.error("Failed to clear home cache as fallback:", cacheError);
    }
  }
}
__name(markHomeCacheDirty, "markHomeCacheDirty");
function getHomeDirtyKeys(scope) {
  const keys = [];
  if (scope === "all" || scope === "public") {
    keys.push(getHomeDirtyKey("public"));
  }
  if (scope === "all" || scope === "private") {
    keys.push(getHomeDirtyKey("private"));
  }
  return keys;
}
__name(getHomeDirtyKeys, "getHomeDirtyKeys");
async function deleteHomeDirtyKeys(env, keys, shouldDelete) {
  try {
    await Promise.all(keys.map(async (key) => {
      if (await shouldDelete(key)) {
        await env.NAV_AUTH.delete(key);
      }
    }));
  } catch (e) {
    console.error("Failed to clear home cache dirty flag:", e);
  }
}
__name(deleteHomeDirtyKeys, "deleteHomeDirtyKeys");
async function clearHomeCacheDirty(env, scope = "all") {
  await deleteHomeDirtyKeys(env, getHomeDirtyKeys(scope), async () => true);
}
__name(clearHomeCacheDirty, "clearHomeCacheDirty");
async function clearHomeCacheDirtyIfValue(env, scope, expectedValue) {
  await deleteHomeDirtyKeys(env, getHomeDirtyKeys(scope), async (key) => {
    const latestValue = await env.NAV_AUTH.get(key);
    return latestValue === expectedValue;
  });
}
__name(clearHomeCacheDirtyIfValue, "clearHomeCacheDirtyIfValue");
async function writeHomeCacheIfUnchanged(env, scope, html, expectedGeneration) {
  if (expectedGeneration === null || expectedGeneration === void 0 || !env.NAV_DB) return false;
  const latestGeneration = await getGraphCacheGeneration(env);
  if (latestGeneration !== expectedGeneration) return false;
  await env.NAV_AUTH.put(getHomeCacheKey(scope, expectedGeneration), html, { expirationTtl: HOME_CACHE_TTL });
  return true;
}
__name(writeHomeCacheIfUnchanged, "writeHomeCacheIfUnchanged");
function buildSessionCookie(token, options = {}) {
  const maxAge = options.maxAge !== void 0 ? options.maxAge : 86400;
  return `admin_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
__name(buildSessionCookie, "buildSessionCookie");
function getSessionToken(request) {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match2 = cookie.match(/admin_session=([^;]+)/);
  return match2 ? match2[1] : null;
}
__name(getSessionToken, "getSessionToken");
var MAX_TIMING_SAFE_INPUT_LENGTH = 4096;
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length > MAX_TIMING_SAFE_INPUT_LENGTH || b.length > MAX_TIMING_SAFE_INPUT_LENGTH) {
    return false;
  }
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) {
    const dummy = new Uint8Array(bufA.byteLength);
    crypto.subtle.timingSafeEqual(bufA, dummy);
    return false;
  }
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}
__name(timingSafeEqual, "timingSafeEqual");
async function checkRateLimit(env, key, maxRequests, windowSeconds) {
  try {
    const current = await env.NAV_AUTH.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    await env.NAV_AUTH.put(key, String(count + 1), { expirationTtl: windowSeconds });
    return { allowed: true, remaining: maxRequests - count - 1 };
  } catch (e) {
    console.error("Rate limit check failed:", e);
    return { allowed: true, remaining: maxRequests };
  }
}
__name(checkRateLimit, "checkRateLimit");
async function checkLoginRateLimit(env, ip, maxAttempts, lockoutSeconds) {
  const key = `login_fail_${ip}`;
  try {
    const current = await env.NAV_AUTH.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= maxAttempts) {
      return { locked: true, attemptsLeft: 0 };
    }
    return { locked: false, attemptsLeft: maxAttempts - count };
  } catch (e) {
    console.error("Login rate limit check failed:", e);
    return { locked: false, attemptsLeft: maxAttempts };
  }
}
__name(checkLoginRateLimit, "checkLoginRateLimit");
async function recordLoginFailure(env, ip, maxAttempts, lockoutSeconds) {
  const key = `login_fail_${ip}`;
  try {
    const current = await env.NAV_AUTH.get(key);
    const count = current ? parseInt(current, 10) : 0;
    await env.NAV_AUTH.put(key, String(count + 1), { expirationTtl: lockoutSeconds });
  } catch (e) {
    console.error("Record login failure failed:", e);
  }
}
__name(recordLoginFailure, "recordLoginFailure");
async function clearLoginFailures(env, ip) {
  const key = `login_fail_${ip}`;
  try {
    await env.NAV_AUTH.delete(key);
  } catch (e) {
  }
}
__name(clearLoginFailures, "clearLoginFailures");
async function validateCsrfToken(request, env) {
  const sessionToken = getSessionToken(request);
  if (!sessionToken) return { valid: false };
  const storedToken = await env.NAV_AUTH.get(`csrf_${sessionToken}`);
  if (!storedToken) return { valid: false };
  const headerToken = request.headers.get("X-CSRF-Token");
  if (!headerToken) return { valid: false };
  return { valid: timingSafeEqual(headerToken, storedToken) };
}
__name(validateCsrfToken, "validateCsrfToken");
function isSameOrigin(value, url) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === url.protocol && parsed.host === url.host;
  } catch {
    return false;
  }
}
__name(isSameOrigin, "isSameOrigin");
function validateOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin) return isSameOrigin(origin, url);
  const referer = request.headers.get("Referer");
  if (referer) return isSameOrigin(referer, url);
  return false;
}
__name(validateOrigin, "validateOrigin");
async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const respond = /* @__PURE__ */ __name((response) => withSecurityHeaders(response, request.url), "respond");
  try {
    if (env.NAV_DB) {
      const isHomePageGet = method === "GET" && url.pathname === "/" && !url.search;
      if (!isHomePageGet) {
        await ensureSchemaReady(env);
      }
    }
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method) && url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/config/submit") {
        if (!validateOrigin(request)) {
          return respond(errorResponse("Forbidden: invalid origin", 403));
        }
      } else {
        const { valid } = await validateCsrfToken(request, env);
        if (!valid) {
          return respond(errorResponse("Forbidden: invalid CSRF token", 403));
        }
      }
    }
    return respond(await context.next());
  } catch (e) {
    const errorId = crypto.randomUUID();
    console.error(`Unhandled middleware error [${errorId}]:`, e);
    if (url.pathname.startsWith("/api/")) {
      const response = respond(errorResponse("Internal Server Error", 500));
      response.headers.set("X-Error-Id", errorId);
      return response;
    }
    return respond(new Response("Internal Server Error", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Error-Id": errorId
      }
    }));
  }
}
__name(onRequest, "onRequest");

// lib/validators.js
var INPUT_LIMITS = {
  categoryName: 80,
  bookmarkName: 120,
  bookmarkUrl: 2048,
  bookmarkLogo: 2048,
  bookmarkDesc: 1e3,
  importCategories: 2e3,
  importSites: 1e4
};
var IMPORT_BODY_MAX_BYTES = 10 * 1024 * 1024;
var IMPORT_BODY_MAX_MB = IMPORT_BODY_MAX_BYTES / 1024 / 1024;
function normalizeText(value) {
  if (value === null || value === void 0) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
}
__name(normalizeText, "normalizeText");
function validateTextLength(text, label, maxLength) {
  if (text.length > maxLength) {
    return { ok: false, message: `${label}\u4E0D\u80FD\u8D85\u8FC7 ${maxLength} \u4E2A\u5B57\u7B26` };
  }
  return { ok: true };
}
__name(validateTextLength, "validateTextLength");
function normalizeRequiredText(value, label, maxLength) {
  const text = normalizeText(value);
  if (!text) {
    return { ok: false, message: `${label}\u4E0D\u80FD\u4E3A\u7A7A` };
  }
  const lengthCheck = validateTextLength(text, label, maxLength);
  if (!lengthCheck.ok) return lengthCheck;
  return { ok: true, value: text };
}
__name(normalizeRequiredText, "normalizeRequiredText");
function normalizeOptionalText(value, label, maxLength, options = {}) {
  const text = normalizeText(value);
  if (!text) {
    return { ok: true, value: options.nullIfEmpty ? null : "" };
  }
  const lengthCheck = validateTextLength(text, label, maxLength);
  if (!lengthCheck.ok) return lengthCheck;
  return { ok: true, value: text };
}
__name(normalizeOptionalText, "normalizeOptionalText");
var CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
function validateOpaqueText(value, maxLength) {
  const text = String(value ?? "");
  if (text.length > maxLength || CONTROL_CHAR_PATTERN.test(text)) {
    return { ok: false };
  }
  return { ok: true, value: text };
}
__name(validateOpaqueText, "validateOpaqueText");
function normalizeCategoryName(value) {
  return normalizeRequiredText(value, "\u5206\u7C7B\u540D\u79F0", INPUT_LIMITS.categoryName);
}
__name(normalizeCategoryName, "normalizeCategoryName");
function normalizeBookmarkName(value) {
  return normalizeRequiredText(value, "\u4E66\u7B7E\u540D\u79F0", INPUT_LIMITS.bookmarkName);
}
__name(normalizeBookmarkName, "normalizeBookmarkName");
function normalizeBookmarkUrl(value) {
  return normalizeRequiredText(value, "URL", INPUT_LIMITS.bookmarkUrl);
}
__name(normalizeBookmarkUrl, "normalizeBookmarkUrl");
function normalizeOptionalBookmarkUrl(value) {
  return normalizeOptionalText(value, "URL", INPUT_LIMITS.bookmarkUrl);
}
__name(normalizeOptionalBookmarkUrl, "normalizeOptionalBookmarkUrl");
function normalizeBookmarkLogo(value, options = {}) {
  return normalizeOptionalText(value, "Logo", INPUT_LIMITS.bookmarkLogo, options);
}
__name(normalizeBookmarkLogo, "normalizeBookmarkLogo");
function normalizeBookmarkDesc(value, options = {}) {
  return normalizeOptionalText(value, "\u63CF\u8FF0", INPUT_LIMITS.bookmarkDesc, options);
}
__name(normalizeBookmarkDesc, "normalizeBookmarkDesc");
function validateImportSizes(categories, sites) {
  if (Array.isArray(categories) && categories.length > INPUT_LIMITS.importCategories) {
    return { ok: false, message: `\u5BFC\u5165\u5206\u7C7B\u6570\u91CF\u4E0D\u80FD\u8D85\u8FC7 ${INPUT_LIMITS.importCategories} \u4E2A` };
  }
  if (Array.isArray(sites) && sites.length > INPUT_LIMITS.importSites) {
    return { ok: false, message: `\u5BFC\u5165\u4E66\u7B7E\u6570\u91CF\u4E0D\u80FD\u8D85\u8FC7 ${INPUT_LIMITS.importSites} \u4E2A` };
  }
  return { ok: true };
}
__name(validateImportSizes, "validateImportSizes");

// lib/bookmark-export.js
function idKey(value) {
  return String(value ?? "");
}
__name(idKey, "idKey");
function parentIdKey(value) {
  const key = idKey(value);
  return key === "" ? "0" : key;
}
__name(parentIdKey, "parentIdKey");
function bookmarkNameForMessage(site) {
  const value = site?.name;
  if (value === null || value === void 0) return "";
  return String(value).trim();
}
__name(bookmarkNameForMessage, "bookmarkNameForMessage");
function bookmarkErrorLabel(site, index) {
  const name = bookmarkNameForMessage(site);
  return `\u7B2C ${index + 1} \u4E2A\u4E66\u7B7E${name ? `\u300C${name}\u300D` : "\uFF08\u540D\u79F0\u4E3A\u7A7A\uFF09"}`;
}
__name(bookmarkErrorLabel, "bookmarkErrorLabel");
function validateBookmarkExportForImport(data) {
  if (!data || !Array.isArray(data.category) || !Array.isArray(data.sites)) {
    return { ok: false, message: "\u5907\u4EFD\u6570\u636E\u683C\u5F0F\u4E0D\u6B63\u786E" };
  }
  const sizeCheck = validateImportSizes(data.category, data.sites);
  if (!sizeCheck.ok) return sizeCheck;
  const categoryIds = /* @__PURE__ */ new Set();
  const normalizedCategoryNames = /* @__PURE__ */ new Map();
  for (const category of data.category) {
    const key = idKey(category?.id);
    if (!key || key === "0" || categoryIds.has(key)) {
      return { ok: false, message: `\u5206\u7C7B ID \u65E0\u6548\u6216\u91CD\u590D: ${key || "(\u7A7A)"}` };
    }
    const name = normalizeCategoryName(category?.catelog);
    if (!name.ok) {
      return { ok: false, message: `\u5206\u7C7B ${key}: ${name.message}` };
    }
    categoryIds.add(key);
    normalizedCategoryNames.set(key, name.value);
  }
  const parentById = /* @__PURE__ */ new Map();
  const siblingNames = /* @__PURE__ */ new Set();
  for (const category of data.category) {
    const key = idKey(category.id);
    const parentKey = parentIdKey(category.parent_id);
    if (parentKey !== "0" && !categoryIds.has(parentKey)) {
      return { ok: false, message: `\u5206\u7C7B ${key} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u7236\u5206\u7C7B ${parentKey}` };
    }
    parentById.set(key, parentKey);
    const siblingKey = `${parentKey}\0${normalizedCategoryNames.get(key)}`;
    if (siblingNames.has(siblingKey)) {
      return { ok: false, message: `\u540C\u4E00\u7236\u5206\u7C7B\u4E0B\u5B58\u5728\u91CD\u540D\u5206\u7C7B: ${normalizedCategoryNames.get(key)}` };
    }
    siblingNames.add(siblingKey);
  }
  for (const categoryId of categoryIds) {
    const seen = /* @__PURE__ */ new Set();
    let cursor = categoryId;
    while (cursor !== "0") {
      if (seen.has(cursor)) {
        return { ok: false, message: `\u5206\u7C7B ${categoryId} \u5B58\u5728\u5FAA\u73AF\u7236\u7EA7\u5173\u7CFB` };
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) || "0";
    }
  }
  const normalizedUrls = /* @__PURE__ */ new Map();
  for (let index = 0; index < data.sites.length; index++) {
    const site = data.sites[index] || {};
    const label = bookmarkErrorLabel(site, index);
    const name = normalizeBookmarkName(site.name);
    const url = normalizeBookmarkUrl(site.url);
    const logo = normalizeBookmarkLogo(site.logo);
    const desc = normalizeBookmarkDesc(site.desc, { nullIfEmpty: true });
    for (const result of [name, url, logo, desc]) {
      if (!result.ok) return { ok: false, message: `${label}: ${result.message}` };
    }
    const normalizedUrl = normalizeUrlForStorage(url.value);
    if (!normalizedUrl) {
      return { ok: false, message: `${label}: URL \u5FC5\u987B\u4F7F\u7528 http \u6216 https` };
    }
    const siteCategoryId = idKey(site.catelog_id);
    if (siteCategoryId !== "0" && !categoryIds.has(siteCategoryId)) {
      return { ok: false, message: `${label} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u5206\u7C7B ${siteCategoryId || "(\u7A7A)"}` };
    }
    const dedupKey = normalizedUrl.endsWith("/") ? normalizedUrl.slice(0, -1) : normalizedUrl;
    const existing = normalizedUrls.get(dedupKey);
    if (existing) {
      return { ok: false, message: `${label} \u7684 URL \u4E0E\u7B2C ${existing.index + 1} \u4E2A\u4E66\u7B7E\u300C${existing.name}\u300D\u91CD\u590D` };
    }
    normalizedUrls.set(dedupKey, { index, name: name.value });
  }
  return { ok: true };
}
__name(validateBookmarkExportForImport, "validateBookmarkExportForImport");
async function fetchBookmarkExport(env, options = {}) {
  const includePrivate = options.includePrivate === true;
  let categoryQuery = "SELECT id, catelog, sort_order, parent_id, is_private FROM category";
  let sitesQuery = "SELECT id, name, url, logo, desc, catelog_id, sort_order, is_private FROM sites";
  if (!includePrivate) {
    categoryQuery += " WHERE is_private = 0";
    sitesQuery += " WHERE is_private = 0";
  }
  categoryQuery += " ORDER BY sort_order ASC";
  sitesQuery += " ORDER BY sort_order ASC, create_time DESC";
  const [{ results: categories }, { results: sites }] = await Promise.all([
    env.NAV_DB.prepare(categoryQuery).all(),
    env.NAV_DB.prepare(sitesQuery).all()
  ]);
  return {
    category: categories || [],
    sites: sites || []
  };
}
__name(fetchBookmarkExport, "fetchBookmarkExport");

// lib/webdav-client.js
var ENCODED_SEPARATOR_PATTERN = /%(?:2f|5c)/i;
function splitDirSegments(dir) {
  return String(dir ?? "").split(/[/\\]/).map((segment) => segment.trim()).filter((segment) => segment && segment !== "." && segment !== "..");
}
__name(splitDirSegments, "splitDirSegments");
function buildWebdavUrl(baseUrl, dir, filename, trailingSlash = false) {
  const safeBase = sanitizeUrl(baseUrl);
  if (!safeBase) return "";
  if (ENCODED_SEPARATOR_PATTERN.test(String(dir ?? ""))) return "";
  const segments = splitDirSegments(dir);
  if (filename) segments.push(filename);
  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
  const parsed = new URL(safeBase);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
  const basePath = parsed.pathname.replace(/\/+$/, "");
  let pathname = encodedPath ? `${basePath}/${encodedPath}` : basePath || "/";
  if (trailingSlash && !pathname.endsWith("/")) {
    pathname += "/";
  }
  parsed.pathname = pathname;
  parsed.hash = "";
  return parsed.href;
}
__name(buildWebdavUrl, "buildWebdavUrl");
function getUtf8ByteLength(text) {
  return new TextEncoder().encode(String(text ?? "")).byteLength;
}
__name(getUtf8ByteLength, "getUtf8ByteLength");
function buildAuthHeader(username, password) {
  const bytes = new TextEncoder().encode(`${username ?? ""}:${password ?? ""}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}
__name(buildAuthHeader, "buildAuthHeader");
async function webdavFetch(url, init) {
  return fetch(url, { ...init, redirect: "manual" });
}
__name(webdavFetch, "webdavFetch");
function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}
__name(isRedirectStatus, "isRedirectStatus");
var REDIRECT_MESSAGE = "WebDAV \u670D\u52A1\u5668\u8981\u6C42\u91CD\u5B9A\u5411\uFF0C\u8BF7\u628A\u8BBE\u7F6E\u91CC\u7684\u670D\u52A1\u5668\u5730\u5740\u6539\u4E3A\u6700\u7EC8\u5730\u5740";
var LIST_RESPONSE_MAX_BYTES = 5 * 1024 * 1024;
function isMissingParentStatus(status) {
  return status === 404 || status === 409;
}
__name(isMissingParentStatus, "isMissingParentStatus");
async function ensureWebdavDir(baseUrl, dir, authHeader) {
  const segments = splitDirSegments(dir);
  if (segments.length === 0) return { ok: true, status: 201, segment: "" };
  for (let i = 0; i < segments.length; i++) {
    const path = segments.slice(0, i + 1).join("/");
    const dirUrl = buildWebdavUrl(baseUrl, path, "", true);
    if (!dirUrl) return { ok: false, status: 0, segment: path };
    const res = await webdavFetch(dirUrl, {
      method: "MKCOL",
      headers: { Authorization: authHeader }
    });
    if (res.status === 201 || res.status === 405) continue;
    return { ok: false, status: res.status, segment: path };
  }
  return { ok: true, status: 201, segment: "" };
}
__name(ensureWebdavDir, "ensureWebdavDir");
function parsePropfindEntries(xml, dirUrl = "") {
  const text = String(xml ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const entries = [];
  let base = null;
  let baseDir = "";
  if (dirUrl) {
    try {
      base = new URL(dirUrl);
      baseDir = `${decodeURIComponent(base.pathname).replace(/\/+$/, "")}/`;
    } catch {
      return entries;
    }
  }
  const responseRe = /<(?:\w+:)?response[\s>][\s\S]*?<\/(?:\w+:)?response>/gi;
  const decodeXmlText = /* @__PURE__ */ __name((value) => String(value ?? "").replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi,
    (entity, decimal, hexadecimal, named) => {
      if (decimal || hexadecimal) {
        const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()];
    }
  ), "decodeXmlText");
  const pick = /* @__PURE__ */ __name((block, tag) => {
    const m = block.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
    if (!m) return "";
    const cdata = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    const value = (cdata ? cdata[1] : decodeXmlText(m[1])).trim();
    return value;
  }, "pick");
  for (const [block] of text.matchAll(responseRe)) {
    if (/<(?:\w+:)?collection\s*\/?>/i.test(block)) continue;
    const href = pick(block, "href");
    if (!href) continue;
    let name;
    if (base) {
      let parsed;
      let path;
      try {
        parsed = new URL(href, base);
        path = decodeURIComponent(parsed.pathname);
      } catch {
        continue;
      }
      if (parsed.origin !== base.origin) continue;
      if (!path.startsWith(baseDir)) continue;
      const rest = path.slice(baseDir.length).replace(/\/+$/, "");
      if (!rest || rest.includes("/")) continue;
      name = rest;
    } else {
      const rawName = href.replace(/\/+$/, "").split("/").pop() || "";
      try {
        name = decodeURIComponent(rawName);
      } catch {
        name = rawName;
      }
    }
    if (!name) continue;
    entries.push({
      name,
      size: Number(pick(block, "getcontentlength")) || 0,
      lastModified: pick(block, "getlastmodified")
    });
  }
  return entries;
}
__name(parsePropfindEntries, "parsePropfindEntries");
async function listWebdavFiles(params) {
  const { baseUrl, dir = "", username, password } = params;
  const dirUrl = buildWebdavUrl(baseUrl, dir, "", true);
  if (!dirUrl) {
    return { ok: false, status: 0, message: "WebDAV \u5730\u5740\u65E0\u6548\uFF08\u4EC5\u652F\u6301 HTTPS\uFF09", entries: [] };
  }
  try {
    decodeURIComponent(new URL(dirUrl).pathname);
  } catch {
    return { ok: false, status: 0, message: "\u5907\u4EFD\u76EE\u5F55\u5730\u5740\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5 WebDAV \u8BBE\u7F6E", entries: [] };
  }
  const body = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';
  let res;
  try {
    res = await webdavFetch(dirUrl, {
      method: "PROPFIND",
      headers: {
        Authorization: buildAuthHeader(username, password),
        Depth: "1",
        "Content-Type": "application/xml; charset=utf-8"
      },
      body
    });
  } catch (e) {
    return { ok: false, status: 0, message: `\u65E0\u6CD5\u8FDE\u63A5 WebDAV \u670D\u52A1\u5668: ${e.message}`, entries: [] };
  }
  if (isRedirectStatus(res.status)) {
    return { ok: false, status: res.status, message: REDIRECT_MESSAGE, entries: [] };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: "WebDAV \u8BA4\u8BC1\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8D26\u53F7\u4E0E\u5BC6\u7801", entries: [] };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, message: "\u5907\u4EFD\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u6267\u884C\u4E00\u6B21\u5907\u4EFD", entries: [] };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: `WebDAV \u8FD4\u56DE ${res.status}`, entries: [] };
  }
  const read = await readTextWithLimit(res, LIST_RESPONSE_MAX_BYTES);
  if (!read.ok) {
    return {
      ok: false,
      tooLarge: true,
      status: res.status,
      message: `\u5907\u4EFD\u76EE\u5F55\u5217\u8868\u8D85\u8FC7 ${Math.round(LIST_RESPONSE_MAX_BYTES / 1024 / 1024)}MB\uFF0C\u8BF7\u6E05\u7406\u76EE\u5F55\u540E\u91CD\u8BD5`,
      entries: []
    };
  }
  return { ok: true, status: res.status, message: "", entries: parsePropfindEntries(read.text, dirUrl) };
}
__name(listWebdavFiles, "listWebdavFiles");
async function readTextWithLimit(res, maxBytes) {
  const declared = Number(res.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, tooLarge: true };
  }
  if (!res.body) {
    return { ok: true, text: await res.text() };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
      }
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
__name(readTextWithLimit, "readTextWithLimit");
async function downloadWebdavFile(params) {
  const { baseUrl, dir = "", filename, username, password, maxBytes } = params;
  const targetUrl = buildWebdavUrl(baseUrl, dir, filename);
  if (!targetUrl || !filename) {
    return { ok: false, status: 0, message: "WebDAV \u5730\u5740\u65E0\u6548\uFF08\u4EC5\u652F\u6301 HTTPS\uFF09", content: "", byteLength: 0 };
  }
  let res;
  try {
    res = await webdavFetch(targetUrl, {
      method: "GET",
      headers: { Authorization: buildAuthHeader(username, password) }
    });
  } catch (e) {
    return { ok: false, status: 0, message: `\u65E0\u6CD5\u8FDE\u63A5 WebDAV \u670D\u52A1\u5668: ${e.message}`, content: "", byteLength: 0 };
  }
  if (isRedirectStatus(res.status)) {
    return { ok: false, status: res.status, message: REDIRECT_MESSAGE, content: "", byteLength: 0 };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: "WebDAV \u8BA4\u8BC1\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8D26\u53F7\u4E0E\u5BC6\u7801", content: "", byteLength: 0 };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, message: "\u5907\u4EFD\u6587\u4EF6\u4E0D\u5B58\u5728", content: "", byteLength: 0 };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: `WebDAV \u8FD4\u56DE ${res.status}`, content: "", byteLength: 0 };
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    const text = await res.text();
    return { ok: true, status: res.status, message: "", content: text, byteLength: getUtf8ByteLength(text) };
  }
  const read = await readTextWithLimit(res, maxBytes);
  if (!read.ok) {
    return {
      ok: false,
      tooLarge: true,
      status: res.status,
      message: `\u5907\u4EFD\u6587\u4EF6\u8D85\u8FC7 ${Math.round(maxBytes / 1024 / 1024)}MB \u6062\u590D\u4E0A\u9650`,
      content: "",
      byteLength: 0
    };
  }
  return { ok: true, status: res.status, message: "", content: read.text, byteLength: getUtf8ByteLength(read.text) };
}
__name(downloadWebdavFile, "downloadWebdavFile");
async function deleteWebdavFile(params) {
  const { baseUrl, dir = "", filename, username, password } = params;
  const targetUrl = buildWebdavUrl(baseUrl, dir, filename);
  if (!targetUrl || !filename) {
    return { ok: false, status: 0, message: "WebDAV \u5730\u5740\u65E0\u6548\uFF08\u4EC5\u652F\u6301 HTTPS\uFF09" };
  }
  let res;
  try {
    res = await webdavFetch(targetUrl, {
      method: "DELETE",
      headers: { Authorization: buildAuthHeader(username, password) }
    });
  } catch (e) {
    return { ok: false, status: 0, message: `\u65E0\u6CD5\u8FDE\u63A5 WebDAV \u670D\u52A1\u5668: ${e.message}` };
  }
  if (isRedirectStatus(res.status)) {
    return { ok: false, status: res.status, message: REDIRECT_MESSAGE };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: "WebDAV \u8BA4\u8BC1\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8D26\u53F7\u4E0E\u5BC6\u7801" };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, message: "\u5907\u4EFD\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u5220\u9664" };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: `WebDAV \u8FD4\u56DE ${res.status}` };
  }
  return { ok: true, status: res.status, message: "\u5220\u9664\u6210\u529F" };
}
__name(deleteWebdavFile, "deleteWebdavFile");
async function uploadToWebdav(params) {
  const { baseUrl, dir = "", filename, username, password, content } = params;
  const targetUrl = buildWebdavUrl(baseUrl, dir, filename);
  if (!targetUrl) {
    return { ok: false, status: 0, message: "WebDAV \u5730\u5740\u65E0\u6548\uFF08\u4EC5\u652F\u6301 HTTPS\uFF09", url: "" };
  }
  const authHeader = buildAuthHeader(username, password);
  const putInit = {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: content
  };
  let res;
  try {
    res = await webdavFetch(targetUrl, putInit);
  } catch (e) {
    return { ok: false, status: 0, message: `\u65E0\u6CD5\u8FDE\u63A5 WebDAV \u670D\u52A1\u5668: ${e.message}`, url: targetUrl };
  }
  if (isRedirectStatus(res.status)) {
    return { ok: false, status: res.status, message: REDIRECT_MESSAGE, url: targetUrl };
  }
  if (isMissingParentStatus(res.status) && splitDirSegments(dir).length > 0) {
    let dirResult;
    try {
      dirResult = await ensureWebdavDir(baseUrl, dir, authHeader);
    } catch (e) {
      return { ok: false, status: res.status, message: `\u521B\u5EFA\u5907\u4EFD\u76EE\u5F55\u5931\u8D25: ${e.message}`, url: targetUrl };
    }
    if (!dirResult.ok) {
      const detail = dirResult.status ? `WebDAV \u8FD4\u56DE ${dirResult.status}` : "\u5730\u5740\u65E0\u6548";
      return {
        ok: false,
        status: dirResult.status || res.status,
        message: `\u521B\u5EFA\u5907\u4EFD\u76EE\u5F55\u300C${dirResult.segment}\u300D\u5931\u8D25: ${detail}`,
        url: targetUrl
      };
    }
    res = await webdavFetch(targetUrl, putInit);
    if (isRedirectStatus(res.status)) {
      return { ok: false, status: res.status, message: REDIRECT_MESSAGE, url: targetUrl };
    }
  }
  if (res.ok) {
    return { ok: true, status: res.status, message: "\u4E0A\u4F20\u6210\u529F", url: targetUrl };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: "WebDAV \u8BA4\u8BC1\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8D26\u53F7\u4E0E\u5BC6\u7801", url: targetUrl };
  }
  return { ok: false, status: res.status, message: `WebDAV \u8FD4\u56DE ${res.status}`, url: targetUrl };
}
__name(uploadToWebdav, "uploadToWebdav");

// api/backup/webdav.js
var WEBDAV_KEYS = ["webdav_url", "webdav_username", "webdav_password", "webdav_dir"];
var BACKUP_LIST_LIMIT = 10;
var BACKUP_FILENAME_RE = /^iori-nav-backup-(\d{8})-(\d{6})-(\d{3})-[0-9a-f]{32}\.json$/i;
function buildBackupFilename(date = /* @__PURE__ */ new Date()) {
  const pad = /* @__PURE__ */ __name((n) => String(n).padStart(2, "0"), "pad");
  const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return `iori-nav-backup-${stamp}-${milliseconds}-${nonce}.json`;
}
__name(buildBackupFilename, "buildBackupFilename");
function parseBackupFilename(filename) {
  const m = BACKUP_FILENAME_RE.exec(String(filename ?? ""));
  if (!m) return "";
  const [, d, t, milliseconds] = m;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.${milliseconds}Z`;
  return Number.isNaN(Date.parse(iso)) ? "" : iso;
}
__name(parseBackupFilename, "parseBackupFilename");
function selectRecentBackups(entries, limit = BACKUP_LIST_LIMIT) {
  return (entries || []).filter((entry) => BACKUP_FILENAME_RE.test(entry?.name || "")).sort((a, b) => b.name.localeCompare(a.name)).slice(0, limit).map((entry) => ({
    filename: entry.name,
    size: entry.size || 0,
    backupTime: parseBackupFilename(entry.name)
  }));
}
__name(selectRecentBackups, "selectRecentBackups");
function validateRestorableBackup(data, byteLength) {
  const importCheck = validateBookmarkExportForImport(data);
  if (!importCheck.ok) return importCheck;
  if (byteLength > IMPORT_BODY_MAX_BYTES) {
    return { ok: false, message: `\u5907\u4EFD\u5185\u5BB9\u8D85\u8FC7 ${IMPORT_BODY_MAX_MB}MB \u5BFC\u5165\u9650\u5236` };
  }
  return { ok: true };
}
__name(validateRestorableBackup, "validateRestorableBackup");
async function loadWebdavConfig(env) {
  const placeholders = WEBDAV_KEYS.map(() => "?").join(",");
  const { results } = await env.NAV_DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).bind(...WEBDAV_KEYS).all();
  const config = {};
  (results || []).forEach((row) => {
    config[row.key] = row.value;
  });
  return config;
}
__name(loadWebdavConfig, "loadWebdavConfig");
async function prepareWebdav(context, rateKey, busyMessage) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return { error: errorResponse("Unauthorized", 401) };
  }
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const { allowed } = await checkRateLimit(env, `${rateKey}_${ip}`, 10, 60);
  if (!allowed) {
    return { error: errorResponse(busyMessage, 429) };
  }
  const config = await loadWebdavConfig(env);
  const baseUrl = String(config.webdav_url || "").trim();
  const password = String(config.webdav_password || "");
  if (!baseUrl) {
    return { error: errorResponse("WebDAV \u672A\u914D\u7F6E\uFF0C\u8BF7\u5148\u586B\u5199\u670D\u52A1\u5668\u5730\u5740", 400) };
  }
  if (!password) {
    return { error: errorResponse("WebDAV \u672A\u914D\u7F6E\uFF0C\u8BF7\u5148\u586B\u5199\u5BC6\u7801", 400) };
  }
  return { config, baseUrl, password };
}
__name(prepareWebdav, "prepareWebdav");
async function onRequestPost(context) {
  const { env } = context;
  try {
    const prepared = await prepareWebdav(context, "webdav_backup", "\u5907\u4EFD\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
    if (prepared.error) return prepared.error;
    const { config, baseUrl, password } = prepared;
    const data = await fetchBookmarkExport(env, { includePrivate: true });
    const content = JSON.stringify(data, null, 2);
    const byteLength = getUtf8ByteLength(content);
    const restorableCheck = validateRestorableBackup(data, byteLength);
    if (!restorableCheck.ok) {
      return errorResponse(`\u65E0\u6CD5\u521B\u5EFA\u53EF\u6062\u590D\u7684\u5907\u4EFD: ${restorableCheck.message}`, 413);
    }
    const filename = buildBackupFilename();
    const result = await uploadToWebdav({
      baseUrl,
      dir: config.webdav_dir || "",
      filename,
      username: config.webdav_username || "",
      password,
      content
    });
    if (!result.ok) {
      return errorResponse(`\u5907\u4EFD\u5931\u8D25: ${result.message}`, 502);
    }
    return jsonResponse({
      code: 200,
      message: "\u5907\u4EFD\u6210\u529F",
      data: {
        filename,
        size: byteLength,
        categoryCount: data.category.length,
        siteCount: data.sites.length
      }
    });
  } catch (e) {
    return errorResponse(`\u5907\u4EFD\u5931\u8D25: ${e.message}`, 500);
  }
}
__name(onRequestPost, "onRequestPost");
async function onRequestGet(context) {
  const { request } = context;
  try {
    const prepared = await prepareWebdav(context, "webdav_list", "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
    if (prepared.error) return prepared.error;
    const { config, baseUrl, password } = prepared;
    const searchParams = new URL(request.url).searchParams;
    const filename = searchParams.get("filename");
    if (filename !== null) {
      return downloadBackup({ config, baseUrl, password, filename });
    }
    const requestedLimit = Number(searchParams.get("limit"));
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 && requestedLimit <= 50 ? requestedLimit : BACKUP_LIST_LIMIT;
    const result = await listWebdavFiles({
      baseUrl,
      dir: config.webdav_dir || "",
      username: config.webdav_username || "",
      password
    });
    if (!result.ok) {
      if (result.tooLarge) {
        return errorResponse(`\u83B7\u53D6\u5907\u4EFD\u5217\u8868\u5931\u8D25: ${result.message}`, 413);
      }
      return errorResponse(`\u83B7\u53D6\u5907\u4EFD\u5217\u8868\u5931\u8D25: ${result.message}`, result.status >= 400 && result.status < 500 ? 400 : 502);
    }
    return jsonResponse({
      code: 200,
      message: "ok",
      data: {
        backups: selectRecentBackups(result.entries, limit)
      }
    });
  } catch (e) {
    return errorResponse(`\u83B7\u53D6\u5907\u4EFD\u5217\u8868\u5931\u8D25: ${e.message}`, 500);
  }
}
__name(onRequestGet, "onRequestGet");
async function onRequestDelete(context) {
  const { request } = context;
  try {
    const prepared = await prepareWebdav(context, "webdav_delete", "\u5220\u9664\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
    if (prepared.error) return prepared.error;
    const { config, baseUrl, password } = prepared;
    const filename = new URL(request.url).searchParams.get("filename") || "";
    if (!BACKUP_FILENAME_RE.test(filename)) {
      return errorResponse("\u65E0\u6548\u7684\u5907\u4EFD\u6587\u4EF6\u540D", 400);
    }
    const result = await deleteWebdavFile({
      baseUrl,
      dir: config.webdav_dir || "",
      filename,
      username: config.webdav_username || "",
      password
    });
    if (!result.ok) {
      const status = result.status === 404 ? 404 : result.status >= 400 && result.status < 500 ? 400 : 502;
      return errorResponse(`\u5220\u9664\u5907\u4EFD\u5931\u8D25: ${result.message}`, status);
    }
    return jsonResponse({
      code: 200,
      message: "\u5907\u4EFD\u5DF2\u5220\u9664",
      data: { filename }
    });
  } catch (e) {
    return errorResponse(`\u5220\u9664\u5907\u4EFD\u5931\u8D25: ${e.message}`, 500);
  }
}
__name(onRequestDelete, "onRequestDelete");
async function downloadBackup({ config, baseUrl, password, filename }) {
  if (!BACKUP_FILENAME_RE.test(filename)) {
    return errorResponse("\u65E0\u6548\u7684\u5907\u4EFD\u6587\u4EF6\u540D", 400);
  }
  try {
    const result = await downloadWebdavFile({
      baseUrl,
      dir: config.webdav_dir || "",
      filename,
      username: config.webdav_username || "",
      password,
      // 上限在读取时生效：先看 Content-Length，chunked 响应则边读边计数并提前 cancel
      maxBytes: IMPORT_BODY_MAX_BYTES
    });
    if (!result.ok) {
      if (result.tooLarge) {
        return errorResponse(`\u5907\u4EFD\u8D85\u51FA\u6062\u590D\u9650\u5236: ${result.message}`, 413);
      }
      return errorResponse(`\u4E0B\u8F7D\u5907\u4EFD\u5931\u8D25: ${result.message}`, result.status >= 400 && result.status < 500 ? 400 : 502);
    }
    let parsed;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      return errorResponse("\u5907\u4EFD\u6587\u4EF6\u5185\u5BB9\u4E0D\u662F\u6709\u6548\u7684 JSON", 400);
    }
    if (!parsed || !Array.isArray(parsed.category) || !Array.isArray(parsed.sites)) {
      return errorResponse("\u5907\u4EFD\u6587\u4EF6\u683C\u5F0F\u4E0D\u6B63\u786E", 400);
    }
    const restorableCheck = validateRestorableBackup(parsed, result.byteLength);
    if (!restorableCheck.ok) {
      return errorResponse(`\u5907\u4EFD\u8D85\u51FA\u6062\u590D\u9650\u5236: ${restorableCheck.message}`, 413);
    }
    return jsonResponse({
      code: 200,
      message: "ok",
      data: {
        filename,
        size: result.byteLength,
        category: parsed.category,
        sites: parsed.sites
      }
    });
  } catch (e) {
    return errorResponse(`\u4E0B\u8F7D\u5907\u4EFD\u5931\u8D25: ${e.message}`, 500);
  }
}
__name(downloadBackup, "downloadBackup");

// api/cache/clear.js
async function onRequestPost2(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    await clearHomeCache(env, "all");
    await env.NAV_AUTH.delete("settings_cache");
    await clearGraphCache(env, { throwOnError: true });
    await clearHomeCacheDirty(env, "all");
    const response = jsonResponse({
      code: 200,
      message: "\u9996\u9875\u4E0E\u8BBE\u7F6E\u7F13\u5B58\u5DF2\u6E05\u9664"
    });
    response.headers.append("Set-Cookie", "iori_cache_stale=; Path=/; Max-Age=0; SameSite=Lax");
    response.headers.append("Set-Cookie", "iori_cache_public_stale=; Path=/; Max-Age=0; SameSite=Lax");
    response.headers.append("Set-Cookie", "iori_cache_private_stale=; Path=/; Max-Age=0; SameSite=Lax");
    return response;
  } catch (e) {
    return errorResponse(`Failed to clear cache: ${e.message}`, 500);
  }
}
__name(onRequestPost2, "onRequestPost");

// api/categories/create.js
async function onRequestPost3(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const body = await request.json();
    const categoryNameResult = normalizeCategoryName(body.catelog);
    if (!categoryNameResult.ok) {
      return errorResponse(categoryNameResult.message, 400);
    }
    const categoryName = categoryNameResult.value;
    const parentId = body.parent_id ? parseInt(body.parent_id, 10) : 0;
    let parentCategory = null;
    if (parentId !== 0) {
      parentCategory = await env.NAV_DB.prepare("SELECT id, is_private FROM category WHERE id = ?").bind(parentId).first();
      if (!parentCategory) {
        return errorResponse("\u7236\u5206\u7C7B\u4E0D\u5B58\u5728", 400);
      }
    }
    const existing = await env.NAV_DB.prepare(
      "SELECT catelog FROM category WHERE catelog = ? AND parent_id = ?"
    ).bind(categoryName, parentId).first();
    if (existing) {
      return errorResponse("\u8BE5\u5206\u7C7B\u540D\u79F0\u5728\u5F53\u524D\u7236\u5206\u7C7B\u4E0B\u5DF2\u5B58\u5728", 400);
    }
    const sortOrderValue = normalizeSortOrder(body.sort_order);
    const isPrivate = parentCategory?.is_private === 1 ? 1 : body.is_private ? 1 : 0;
    await env.NAV_DB.prepare(`
      INSERT INTO category (catelog, sort_order, parent_id, is_private)
      VALUES (?, ?, ?, ?)
    `).bind(categoryName, sortOrderValue, parentId, isPrivate).run();
    await markHomeCacheDirty(env, isPrivate ? "private" : "all");
    return jsonResponse({
      code: 201,
      message: "\u5206\u7C7B\u521B\u5EFA\u6210\u529F",
      data: {
        catelog: categoryName,
        sort_order: sortOrderValue,
        parent_id: parentId,
        is_private: isPrivate
      }
    }, 201);
  } catch (e) {
    return errorResponse(`\u521B\u5EFA\u5206\u7C7B\u5931\u8D25: ${e.message}`, 500);
  }
}
__name(onRequestPost3, "onRequestPost");

// api/categories/reorder.js
var REORDER_CHUNK_SIZE = 100;
async function onRequestPost4(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  let dbMayHaveChanged = false;
  try {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse("\u6392\u5E8F\u6570\u636E\u4E0D\u80FD\u4E3A\u7A7A", 400);
    }
    const statements = [];
    for (const item of items) {
      const id = Number(item.id);
      const sortOrder = Number(item.sort_order);
      if (!Number.isFinite(id) || !Number.isFinite(sortOrder)) {
        return errorResponse("\u6392\u5E8F\u6570\u636E\u683C\u5F0F\u65E0\u6548", 400);
      }
      statements.push(
        env.NAV_DB.prepare(
          "UPDATE category SET sort_order = ?, update_time = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(sortOrder, id)
      );
    }
    dbMayHaveChanged = true;
    for (let i = 0; i < statements.length; i += REORDER_CHUNK_SIZE) {
      await env.NAV_DB.batch(statements.slice(i, i + REORDER_CHUNK_SIZE));
    }
    return jsonResponse({
      code: 200,
      message: `\u6210\u529F\u66F4\u65B0 ${items.length} \u4E2A\u5206\u7C7B\u7684\u6392\u5E8F`
    });
  } catch (e) {
    return errorResponse(`\u4FDD\u5B58\u5206\u7C7B\u6392\u5E8F\u5931\u8D25: ${e.message}`, 500);
  } finally {
    if (dbMayHaveChanged) {
      await markHomeCacheDirty(env, "all");
    }
  }
}
__name(onRequestPost4, "onRequestPost");

// api/config/batch.js
async function findPrivateCategoriesForSites(env, idChunks) {
  const privateCategories = /* @__PURE__ */ new Map();
  for (const chunk of idChunks) {
    const placeholders = chunk.map(() => "?").join(",");
    const { results = [] } = await env.NAV_DB.prepare(`
      SELECT DISTINCT c.id, c.catelog, c.parent_id
      FROM sites s
      INNER JOIN category c ON c.id = s.catelog_id
      WHERE s.id IN (${placeholders}) AND c.is_private = 1
    `).bind(...chunk).all();
    results.forEach((category) => {
      privateCategories.set(category.id, {
        name: category.catelog,
        parentId: Number(category.parent_id || 0)
      });
    });
  }
  return privateCategories;
}
__name(findPrivateCategoriesForSites, "findPrivateCategoriesForSites");
async function findBlockingPrivateParents(env, privateCategories) {
  const parentIds = [...new Set(
    [...privateCategories.values()].map((category) => category.parentId).filter((parentId) => parentId && !privateCategories.has(parentId))
  )];
  const blockingParents = /* @__PURE__ */ new Map();
  for (let i = 0; i < parentIds.length; i += 50) {
    const chunk = parentIds.slice(i, i + 50);
    const placeholders = chunk.map(() => "?").join(",");
    const { results = [] } = await env.NAV_DB.prepare(`
      SELECT id, catelog
      FROM category
      WHERE id IN (${placeholders}) AND is_private = 1
    `).bind(...chunk).all();
    results.forEach((category) => {
      blockingParents.set(category.id, category.catelog);
    });
  }
  return blockingParents;
}
__name(findBlockingPrivateParents, "findBlockingPrivateParents");
function groupPrivateCategoriesByDepth(privateCategories) {
  const depthCache = /* @__PURE__ */ new Map();
  const getDepth = /* @__PURE__ */ __name((id, visiting = /* @__PURE__ */ new Set()) => {
    if (depthCache.has(id)) return depthCache.get(id);
    if (visiting.has(id)) return 0;
    const category = privateCategories.get(id);
    if (!category?.parentId || !privateCategories.has(category.parentId)) {
      depthCache.set(id, 0);
      return 0;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const depth = getDepth(category.parentId, nextVisiting) + 1;
    depthCache.set(id, depth);
    return depth;
  }, "getDepth");
  const groups = /* @__PURE__ */ new Map();
  for (const id of privateCategories.keys()) {
    const depth = getDepth(id);
    if (!groups.has(depth)) groups.set(depth, []);
    groups.get(depth).push(id);
  }
  return [...groups.entries()].sort(([depthA], [depthB]) => depthA - depthB).map(([, ids]) => ids);
}
__name(groupPrivateCategoriesByDepth, "groupPrivateCategoriesByDepth");
async function onRequestPost5(context) {
  const { request, env } = context;
  const REORDER_CHUNK_SIZE2 = 100;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  let dbMayHaveChanged = false;
  try {
    const { action, ids, payload } = await request.json();
    const requiresIds = action !== "reorder";
    if (requiresIds && (!ids || !Array.isArray(ids) || ids.length === 0)) {
      return errorResponse("\u672A\u63D0\u4F9B ID", 400);
    }
    const CHUNK_SIZE = 50;
    const chunks = [];
    if (requiresIds) {
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        chunks.push(ids.slice(i, i + CHUNK_SIZE));
      }
    }
    const statements = [];
    if (action === "delete") {
      chunks.forEach((chunk) => {
        const placeholders = chunk.map(() => "?").join(",");
        statements.push(
          env.NAV_DB.prepare(`DELETE FROM sites WHERE id IN (${placeholders})`).bind(...chunk)
        );
      });
      await env.NAV_DB.batch(statements);
      await markHomeCacheDirty(env, "all");
      return jsonResponse({
        code: 200,
        message: `\u6210\u529F\u5220\u9664 ${ids.length} \u6761\u9879\u76EE`
      });
    } else if (action === "update_category") {
      const { categoryId } = payload;
      if (!categoryId) {
        return errorResponse("\u5206\u7C7B ID \u662F\u5FC5\u586B\u9879", 400);
      }
      const category = await env.NAV_DB.prepare("SELECT catelog, is_private FROM category WHERE id = ?").bind(categoryId).first();
      if (!category) {
        return errorResponse("\u627E\u4E0D\u5230\u5206\u7C7B", 404);
      }
      let baseSql = `UPDATE sites SET catelog_id = ?, catelog_name = ?`;
      const baseParams = [categoryId, category.catelog];
      if (category.is_private === 1) {
        baseSql += `, is_private = 1`;
      }
      chunks.forEach((chunk) => {
        const placeholders = chunk.map(() => "?").join(",");
        statements.push(
          env.NAV_DB.prepare(`${baseSql} WHERE id IN (${placeholders})`).bind(...baseParams, ...chunk)
        );
      });
      await env.NAV_DB.batch(statements);
      await markHomeCacheDirty(env, "all");
      return jsonResponse({
        code: 200,
        message: `\u6210\u529F\u66F4\u65B0 ${ids.length} \u6761\u9879\u76EE\u7684\u5206\u7C7B`
      });
    } else if (action === "update_privacy") {
      const { isPrivate, publicizePrivateCategories } = payload;
      if (isPrivate === void 0) {
        return errorResponse("\u9690\u79C1\u72B6\u6001\u662F\u5FC5\u586B\u9879", 400);
      }
      const isPrivateValue = isPrivate ? 1 : 0;
      if (isPrivateValue === 0) {
        const privateCategories = await findPrivateCategoriesForSites(env, chunks);
        if (privateCategories.size > 0) {
          if (publicizePrivateCategories !== true) {
            const names = [...privateCategories.entries()].map(([id, category]) => category.name || `\u5206\u7C7B #${id}`);
            const shownNames = names.slice(0, 5).join("\u3001");
            const suffix = names.length > 5 ? ` \u7B49 ${names.length} \u4E2A\u5206\u7C7B` : "";
            return errorResponse(
              `\u4EE5\u4E0B\u79C1\u5BC6\u5206\u7C7B\u4E2D\u7684\u4E66\u7B7E\u4E0D\u80FD\u76F4\u63A5\u8BBE\u4E3A\u516C\u5F00\uFF1A${shownNames}${suffix}\u3002\u8BF7\u786E\u8BA4\u540C\u65F6\u516C\u5F00\u8FD9\u4E9B\u5206\u7C7B\u3002`,
              409
            );
          }
          const blockingParents = await findBlockingPrivateParents(env, privateCategories);
          if (blockingParents.size > 0) {
            const names = [...blockingParents.entries()].map(([id, name]) => name || `\u5206\u7C7B #${id}`);
            const shownNames = names.slice(0, 5).join("\u3001");
            const suffix = names.length > 5 ? ` \u7B49 ${names.length} \u4E2A\u5206\u7C7B` : "";
            return errorResponse(
              `\u4EE5\u4E0B\u79C1\u5BC6\u4E0A\u7EA7\u5206\u7C7B\u672A\u88AB\u9009\u4E2D\uFF0C\u65E0\u6CD5\u5728\u672C\u6B21\u64CD\u4F5C\u4E2D\u516C\u5F00\uFF1A${shownNames}${suffix}\u3002\u8BF7\u5148\u516C\u5F00\u5176\u4E0A\u7EA7\u5206\u7C7B\u3002`,
              409
            );
          }
          const categoryGroups = groupPrivateCategoriesByDepth(privateCategories);
          for (const group of categoryGroups) {
            for (let i = 0; i < group.length; i += 50) {
              const chunk = group.slice(i, i + 50);
              const placeholders = chunk.map(() => "?").join(",");
              statements.push(
                env.NAV_DB.prepare(`UPDATE category SET is_private = 0 WHERE id IN (${placeholders})`).bind(...chunk)
              );
            }
          }
        }
      }
      chunks.forEach((chunk) => {
        const placeholders = chunk.map(() => "?").join(",");
        statements.push(
          env.NAV_DB.prepare(`UPDATE sites SET is_private = ? WHERE id IN (${placeholders})`).bind(isPrivateValue, ...chunk)
        );
      });
      await env.NAV_DB.batch(statements);
      await markHomeCacheDirty(env, "all");
      return jsonResponse({
        code: 200,
        message: `\u6210\u529F\u66F4\u65B0 ${ids.length} \u6761\u9879\u76EE\u7684\u9690\u79C1\u5C5E\u6027`
      });
    } else if (action === "reorder") {
      const items = payload?.items;
      if (!Array.isArray(items) || items.length === 0) {
        return errorResponse("\u6392\u5E8F\u6570\u636E\u4E0D\u80FD\u4E3A\u7A7A", 400);
      }
      const reorderStatements = [];
      for (const item of items) {
        const id = Number(item.id);
        const sortOrder = Number(item.sort_order);
        if (!Number.isFinite(id) || !Number.isFinite(sortOrder)) {
          return errorResponse("\u6392\u5E8F\u6570\u636E\u683C\u5F0F\u65E0\u6548", 400);
        }
        reorderStatements.push(
          env.NAV_DB.prepare("UPDATE sites SET sort_order = ?, update_time = CURRENT_TIMESTAMP WHERE id = ?").bind(sortOrder, id)
        );
      }
      dbMayHaveChanged = true;
      for (let i = 0; i < reorderStatements.length; i += REORDER_CHUNK_SIZE2) {
        await env.NAV_DB.batch(reorderStatements.slice(i, i + REORDER_CHUNK_SIZE2));
      }
      return jsonResponse({
        code: 200,
        message: `\u6210\u529F\u66F4\u65B0 ${items.length} \u6761\u9879\u76EE\u7684\u6392\u5E8F`
      });
    } else {
      return errorResponse("\u65E0\u6548\u7684\u64CD\u4F5C", 400);
    }
  } catch (e) {
    if (String(e?.message || "").includes("privacy_guard_")) {
      return errorResponse("\u5206\u7C7B\u6216\u4E66\u7B7E\u7684\u9690\u79C1\u72B6\u6001\u5DF2\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002", 409);
    }
    return errorResponse(`\u6279\u91CF\u64CD\u4F5C\u5931\u8D25: ${e.message}`, 500);
  } finally {
    if (dbMayHaveChanged) {
      await markHomeCacheDirty(env, "all");
    }
  }
}
__name(onRequestPost5, "onRequestPost");

// api/config/export.js
async function onRequestGet2(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  const url = new URL(request.url);
  const includePrivate = url.searchParams.get("include_private") === "true";
  try {
    const exportData = await fetchBookmarkExport(env, { includePrivate });
    const jsonData = JSON.stringify(exportData, null, 2);
    return new Response(jsonData, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="config.json"',
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (e) {
    return errorResponse(`Failed to export config: ${e.message}`, 500);
  }
}
__name(onRequestGet2, "onRequestGet");

// lib/privacy-guard.js
var buildDescendantsCte = /* @__PURE__ */ __name(() => `
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM category WHERE id = ?
      UNION
      SELECT c.id FROM category c
      INNER JOIN descendants d ON c.parent_id = d.id
    )
  `, "buildDescendantsCte");
function buildPrivateDescendantStatements(db, categoryId) {
  const descendantsCte = buildDescendantsCte();
  return [
    db.prepare(`
      ${descendantsCte}
      UPDATE category
      SET is_private = 1
      WHERE id IN (SELECT id FROM descendants)
    `).bind(categoryId),
    db.prepare(`
      ${descendantsCte}
      UPDATE sites
      SET is_private = 1
      WHERE catelog_id IN (SELECT id FROM descendants)
    `).bind(categoryId)
  ];
}
__name(buildPrivateDescendantStatements, "buildPrivateDescendantStatements");

// api/config/import.js
function getImportIdKey(value) {
  return String(value ?? "");
}
__name(getImportIdKey, "getImportIdKey");
function getImportParentIdKey(value) {
  const key = getImportIdKey(value);
  return key === "" ? "0" : key;
}
__name(getImportParentIdKey, "getImportParentIdKey");
var ROOT_IMPORT_CATEGORY_NAME = "\u9ED8\u8BA4";
async function onRequestPost6(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  let dbMayHaveChanged = false;
  try {
    const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (contentLength > IMPORT_BODY_MAX_BYTES) {
      return errorResponse(`\u8BF7\u6C42\u4F53\u8FC7\u5927\uFF0C\u6700\u5927\u5141\u8BB8 ${IMPORT_BODY_MAX_MB}MB`, 413);
    }
    const jsonData = await request.json();
    let categoriesToImport = [];
    let sitesToImport = [];
    let isNewFormat = false;
    const override = !!jsonData.override;
    let payload = jsonData;
    if (jsonData.category && jsonData.sites && (jsonData.override !== void 0 || Object.keys(jsonData).length > 2)) {
      payload = jsonData;
    } else if (jsonData.category && jsonData.sites) {
      payload = jsonData;
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.category) && Array.isArray(payload.sites)) {
      categoriesToImport = payload.category;
      sitesToImport = payload.sites;
      isNewFormat = true;
    } else if (Array.isArray(jsonData)) {
      sitesToImport = jsonData;
    } else {
      return errorResponse('Invalid JSON format. Expected { "category": [...], "sites": [...] } or an array of sites.', 400);
    }
    const importSizeCheck = validateImportSizes(categoriesToImport, sitesToImport);
    if (!importSizeCheck.ok) {
      return errorResponse(importSizeCheck.message, 400);
    }
    if (sitesToImport.length === 0 && categoriesToImport.length === 0) {
      return jsonResponse({ code: 200, message: "Import successful, but no sites were found to import." });
    }
    const db = env.NAV_DB;
    const BATCH_SIZE = 50;
    const oldCatIdToNewCatIdMap = /* @__PURE__ */ new Map();
    const privateCategoryIdsToPropagate = /* @__PURE__ */ new Set();
    const normalizedImportCategoryNames = /* @__PURE__ */ new Map();
    let categoryNameToIdMap = /* @__PURE__ */ new Map();
    const { results: existingDbCategoriesRaw } = await db.prepare("SELECT id, catelog, parent_id, is_private FROM category").all();
    const existingDbCategories = existingDbCategoriesRaw || [];
    const findExistingCategory = /* @__PURE__ */ __name((name, parentId) => {
      const normalizedParentId = parentId === null || parentId === void 0 ? 0 : parseInt(parentId, 10);
      return existingDbCategories.find((c) => {
        const dbParentId = c.parent_id === null || c.parent_id === void 0 ? 0 : parseInt(c.parent_id, 10);
        return c.catelog === name && dbParentId === normalizedParentId;
      });
    }, "findExistingCategory");
    if (isNewFormat) {
      for (const cat of categoriesToImport) {
        const categoryNameResult = normalizeCategoryName(cat.catelog);
        if (!categoryNameResult.ok) {
          return errorResponse(`\u5BFC\u5165\u5931\u8D25\uFF1A${categoryNameResult.message}`, 400);
        }
        normalizedImportCategoryNames.set(cat, categoryNameResult.value);
      }
      let sortedCats = [];
      let remaining = [...categoriesToImport];
      let processedJsonIds = /* @__PURE__ */ new Set(["0"]);
      let lastRemainingCount = -1;
      while (remaining.length > 0) {
        if (remaining.length === lastRemainingCount) {
          sortedCats.push(...remaining);
          break;
        }
        lastRemainingCount = remaining.length;
        const [ready, notReady] = remaining.reduce((acc, cat) => {
          const pid = getImportParentIdKey(cat.parent_id);
          if (processedJsonIds.has(pid)) {
            acc[0].push(cat);
          } else {
            acc[1].push(cat);
          }
          return acc;
        }, [[], []]);
        ready.sort((a, b) => (a.id || 0) - (b.id || 0));
        ready.forEach((cat) => processedJsonIds.add(getImportIdKey(cat.id)));
        sortedCats.push(...ready);
        remaining = notReady;
      }
      categoriesToImport = sortedCats;
      for (const cat of categoriesToImport) {
        const catName = normalizedImportCategoryNames.get(cat);
        const jsonParentIdKey = getImportParentIdKey(cat.parent_id);
        const importedIsPrivate = cat.is_private ? 1 : 0;
        let dbParentId = 0;
        if (jsonParentIdKey !== "0") {
          if (oldCatIdToNewCatIdMap.has(jsonParentIdKey)) {
            dbParentId = oldCatIdToNewCatIdMap.get(jsonParentIdKey);
          } else {
            dbParentId = 0;
          }
        }
        const parentCategory = dbParentId ? existingDbCategories.find((c) => String(c.id) === String(dbParentId)) : null;
        const isPrivate = parentCategory?.is_private === 1 ? 1 : importedIsPrivate;
        const existing = findExistingCategory(catName, dbParentId);
        if (existing) {
          if (isPrivate === 1 && existing.is_private !== 1) {
            existing.is_private = 1;
            privateCategoryIdsToPropagate.add(existing.id);
          }
          oldCatIdToNewCatIdMap.set(getImportIdKey(cat.id), existing.id);
        } else {
          const sortOrder = normalizeSortOrder(cat.sort_order);
          dbMayHaveChanged = true;
          const result = await db.prepare("INSERT INTO category (catelog, sort_order, parent_id, is_private) VALUES (?, ?, ?, ?)").bind(catName, sortOrder, dbParentId, isPrivate).run();
          let newId = result.meta.last_row_id;
          const newCatObj = { id: newId, catelog: catName, parent_id: dbParentId, is_private: isPrivate };
          existingDbCategories.push(newCatObj);
          oldCatIdToNewCatIdMap.set(getImportIdKey(cat.id), newId);
        }
      }
      if (privateCategoryIdsToPropagate.size > 0) {
        const privateStatements = [];
        privateCategoryIdsToPropagate.forEach((categoryId) => {
          privateStatements.push(...buildPrivateDescendantStatements(db, categoryId));
        });
        dbMayHaveChanged = true;
        await db.batch(privateStatements);
      }
      const hasRootSites = sitesToImport.some((site) => getImportIdKey(site.catelog_id) === "0");
      if (hasRootSites) {
        const rootCategoryNameResult = normalizeCategoryName(ROOT_IMPORT_CATEGORY_NAME);
        if (!rootCategoryNameResult.ok) {
          return errorResponse(`\u5BFC\u5165\u5931\u8D25\uFF1A${rootCategoryNameResult.message}`, 400);
        }
        const rootCategoryName = rootCategoryNameResult.value;
        const existingRootCategory = findExistingCategory(rootCategoryName, 0);
        if (existingRootCategory) {
          oldCatIdToNewCatIdMap.set("0", existingRootCategory.id);
        } else {
          dbMayHaveChanged = true;
          const result = await db.prepare("INSERT INTO category (catelog, sort_order, parent_id, is_private) VALUES (?, ?, ?, ?)").bind(rootCategoryName, 9999, 0, 0).run();
          const newRootCategoryId = result.meta.last_row_id;
          existingDbCategories.push({
            id: newRootCategoryId,
            catelog: rootCategoryName,
            parent_id: 0,
            is_private: 0
          });
          oldCatIdToNewCatIdMap.set("0", newRootCategoryId);
        }
      }
    } else {
      if (existingDbCategories) {
        existingDbCategories.forEach((c) => categoryNameToIdMap.set(c.catelog, c.id));
      }
      const defaultCategory = "Default";
      const categoryNames = [...new Set(sitesToImport.map((item) => {
        const categoryNameResult = normalizeCategoryName(item.catelog || defaultCategory);
        return categoryNameResult.ok ? categoryNameResult.value : "";
      }))].filter((name) => name);
      const newCategoryNames = categoryNames.filter((name) => !categoryNameToIdMap.has(name));
      if (newCategoryNames.length > 0) {
        const insertStmts = newCategoryNames.map((name) => db.prepare("INSERT INTO category (catelog, is_private) VALUES (?, 0)").bind(name));
        dbMayHaveChanged = true;
        await db.batch(insertStmts);
        for (let i = 0; i < newCategoryNames.length; i += BATCH_SIZE) {
          const chunk = newCategoryNames.slice(i, i + BATCH_SIZE);
          const placeholders = chunk.map(() => "?").join(",");
          const { results: newCategories } = await db.prepare(`SELECT id, catelog, is_private FROM category WHERE catelog IN (${placeholders})`).bind(...chunk).all();
          if (newCategories) {
            newCategories.forEach((c) => {
              categoryNameToIdMap.set(c.catelog, c.id);
              existingDbCategories.push(c);
            });
          }
        }
      }
    }
    const siteUrls = [...new Set(sitesToImport.flatMap((item) => {
      const urlResult = normalizeBookmarkUrl(item.url);
      return urlResult.ok ? getUrlMatchCandidates(urlResult.value) : [];
    }))];
    const existingSiteUrlMap = /* @__PURE__ */ new Map();
    if (siteUrls.length > 0) {
      for (let i = 0; i < siteUrls.length; i += BATCH_SIZE) {
        const chunk = siteUrls.slice(i, i + BATCH_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        const { results: existingSites } = await db.prepare(`SELECT url FROM sites WHERE url IN (${placeholders})`).bind(...chunk).all();
        if (existingSites) {
          existingSites.forEach((site) => {
            const dbUrl = (site.url || "").trim();
            if (dbUrl) existingSiteUrlMap.set(dbUrl, dbUrl);
            getUrlMatchCandidates(dbUrl).forEach((candidate) => existingSiteUrlMap.set(candidate, dbUrl));
          });
        }
      }
    }
    const batchStmts = [];
    let itemsAdded = 0;
    let itemsUpdated = 0;
    let itemsSkipped = 0;
    const iconAPI = env.ICON_API || "https://faviconsnap.com/api/favicon?url=";
    const processedUrls = /* @__PURE__ */ new Set();
    for (const site of sitesToImport) {
      const nameResult = normalizeBookmarkName(site.name);
      const urlResult = normalizeBookmarkUrl(site.url);
      const logoResult = normalizeBookmarkLogo(site.logo);
      const descResult = normalizeBookmarkDesc(site.desc, { nullIfEmpty: true });
      if (!nameResult.ok || !urlResult.ok || !logoResult.ok || !descResult.ok) {
        itemsSkipped++;
        continue;
      }
      const rawUrl = urlResult.value;
      const sanitizedUrl = normalizeUrlForStorage(rawUrl);
      const dedupKey = sanitizedUrl.endsWith("/") ? sanitizedUrl.slice(0, -1) : sanitizedUrl;
      const sanitizedName = nameResult.value;
      if (!sanitizedUrl) {
        itemsSkipped++;
        continue;
      }
      if (processedUrls.has(dedupKey)) {
        itemsSkipped++;
        continue;
      }
      if (isNewFormat && (site.catelog_id === void 0 || site.catelog_id === null)) {
        itemsSkipped++;
        continue;
      }
      const existingDbUrl = getUrlMatchCandidates(rawUrl).map((candidate) => existingSiteUrlMap.get(candidate)).find(Boolean) || null;
      const exists = Boolean(existingDbUrl);
      if (exists && !override) {
        itemsSkipped++;
        continue;
      }
      let newCatId;
      let catNameForDb;
      let catIsPrivate = 0;
      if (isNewFormat) {
        newCatId = oldCatIdToNewCatIdMap.get(getImportIdKey(site.catelog_id));
        const catObj = existingDbCategories.find((c) => String(c.id) === String(newCatId));
        if (catObj) {
          catNameForDb = catObj.catelog;
          catIsPrivate = catObj.is_private || 0;
        }
      } else {
        const catNameResult = normalizeCategoryName(site.catelog || "Default");
        if (!catNameResult.ok) {
          itemsSkipped++;
          continue;
        }
        const catName = catNameResult.value;
        newCatId = categoryNameToIdMap.get(catName);
        catNameForDb = catName;
        const catObj = existingDbCategories.find((c) => c.id === newCatId);
        if (catObj) {
          catIsPrivate = catObj.is_private || 0;
        }
      }
      if (!newCatId) {
        itemsSkipped++;
        continue;
      }
      let sanitizedLogo = logoResult.value;
      if ((!sanitizedLogo || sanitizedLogo.startsWith("data:image")) && sanitizedUrl.startsWith("http")) {
        const domain = sanitizedUrl.replace(/^https?:\/\//, "").split("/")[0];
        sanitizedLogo = `${iconAPI}${domain}`;
      }
      if (!sanitizedLogo) sanitizedLogo = null;
      const sanitizedDesc = descResult.value;
      const sortOrderValue = normalizeSortOrder(site.sort_order);
      const sortOrderUpdate = site.sort_order === void 0 || site.sort_order === null ? null : sortOrderValue;
      let finalIsPrivate = site.is_private ? 1 : 0;
      if (catIsPrivate === 1) {
        finalIsPrivate = 1;
      }
      if (exists && override) {
        processedUrls.add(dedupKey);
        batchStmts.push(
          db.prepare("UPDATE sites SET name=?, logo=?, desc=?, catelog_id=?, catelog_name=?, sort_order=COALESCE(?, sort_order), is_private=?, update_time=CURRENT_TIMESTAMP WHERE url=?").bind(sanitizedName, sanitizedLogo, sanitizedDesc, newCatId, catNameForDb, sortOrderUpdate, finalIsPrivate, existingDbUrl)
        );
        itemsUpdated++;
      } else {
        processedUrls.add(dedupKey);
        batchStmts.push(
          db.prepare("INSERT INTO sites (name, url, logo, desc, catelog_id, catelog_name, sort_order, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, newCatId, catNameForDb, sortOrderValue, finalIsPrivate)
        );
        itemsAdded++;
      }
    }
    if (batchStmts.length > 0) {
      dbMayHaveChanged = true;
      for (let i = 0; i < batchStmts.length; i += BATCH_SIZE) {
        const chunk = batchStmts.slice(i, i + BATCH_SIZE);
        await db.batch(chunk);
      }
    }
    let msg = `\u5BFC\u5165\u5B8C\u6210\u3002`;
    if (itemsAdded > 0) msg += ` \u65B0\u589E ${itemsAdded} \u4E2A`;
    if (itemsUpdated > 0) msg += ` \u66F4\u65B0 ${itemsUpdated} \u4E2A`;
    if (itemsSkipped > 0) msg += ` \u8DF3\u8FC7 ${itemsSkipped} \u4E2A`;
    return jsonResponse({
      code: 201,
      message: msg
    }, 201);
  } catch (error) {
    return errorResponse(`Failed to import config: ${error.message}`, 500);
  } finally {
    if (dbMayHaveChanged) {
      await markHomeCacheDirty(env, "all");
    }
  }
}
__name(onRequestPost6, "onRequestPost");

// lib/turnstile.js
var TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
function getTurnstileConfig(env = {}) {
  const siteKey = String(env.TURNSTILE_SITE_KEY || "").trim();
  const secretKey = String(env.TURNSTILE_SECRET_KEY || "").trim();
  return {
    siteKey,
    secretKey,
    isConfigured: Boolean(siteKey || secretKey),
    isComplete: Boolean(siteKey && secretKey)
  };
}
__name(getTurnstileConfig, "getTurnstileConfig");
async function verifyTurnstileToken(token, env, ip) {
  const { secretKey, isConfigured, isComplete } = getTurnstileConfig(env);
  if (!isConfigured) {
    return { ok: true };
  }
  if (!isComplete) {
    return { ok: false, message: "Turnstile \u914D\u7F6E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u68C0\u67E5\u73AF\u5883\u53D8\u91CF" };
  }
  if (!token) {
    return { ok: false, message: "\u8BF7\u5148\u5B8C\u6210\u4EBA\u673A\u9A8C\u8BC1" };
  }
  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (ip && ip !== "unknown") {
    formData.append("remoteip", ip);
  }
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(8e3)
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      return { ok: false, message: "\u4EBA\u673A\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" };
    }
    return { ok: true };
  } catch (error) {
    console.error("Turnstile verification failed:", error);
    return { ok: false, message: "\u4EBA\u673A\u9A8C\u8BC1\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5" };
  }
}
__name(verifyTurnstileToken, "verifyTurnstileToken");

// api/config/submit.js
async function onRequestPost7(context) {
  const { request, env } = context;
  if (!isSubmissionEnabled(env)) {
    return errorResponse("Public submission disabled", 403);
  }
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const { allowed } = await checkRateLimit(env, `submit_rate_${ip}`, 5, 60);
  if (!allowed) {
    return errorResponse("\u63D0\u4EA4\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5", 429);
  }
  try {
    const config = await request.json();
    const { name, url, logo, desc, catelog_id, turnstileToken } = config;
    const turnstileResult = await verifyTurnstileToken(turnstileToken, env, ip);
    if (!turnstileResult.ok) {
      return errorResponse(turnstileResult.message, 403);
    }
    const nameResult = normalizeBookmarkName(name);
    if (!nameResult.ok) return errorResponse(nameResult.message, 400);
    const urlResult = normalizeBookmarkUrl(url);
    if (!urlResult.ok) return errorResponse(urlResult.message, 400);
    const logoResult = normalizeBookmarkLogo(logo, { nullIfEmpty: true });
    if (!logoResult.ok) return errorResponse(logoResult.message, 400);
    const descResult = normalizeBookmarkDesc(desc, { nullIfEmpty: true });
    if (!descResult.ok) return errorResponse(descResult.message, 400);
    const sanitizedName = nameResult.value;
    const rawUrl = urlResult.value;
    const sanitizedUrl = normalizeUrlForStorage(rawUrl);
    const sanitizedLogo = logoResult.value;
    const sanitizedDesc = descResult.value;
    if (!catelog_id) {
      return errorResponse("Category is required", 400);
    }
    if (!sanitizedUrl) {
      return errorResponse("URL must be a valid http or https URL", 400);
    }
    const categoryResult = await env.NAV_DB.prepare("SELECT catelog, is_private FROM category WHERE id = ?").bind(catelog_id).first();
    if (!categoryResult || categoryResult.is_private === 1) {
      return errorResponse("Category not found", 400);
    }
    const catelogName = categoryResult.catelog;
    await env.NAV_DB.prepare(`
      INSERT INTO pending_sites (name, url, logo, desc, catelog_id, catelog_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, catelog_id, catelogName).run();
    return jsonResponse({
      code: 201,
      message: "Config submitted successfully, waiting for admin approve"
    }, 201);
  } catch (e) {
    return errorResponse(`Failed to submit config: ${e.message}`, 500);
  }
}
__name(onRequestPost7, "onRequestPost");

// api/categories/[id].js
var ANCESTOR_HIT_SQL = `
  WITH RECURSIVE ancestors(id) AS (
    SELECT id FROM category WHERE id = ?
    UNION
    SELECT c.parent_id FROM category c
    INNER JOIN ancestors a ON c.id = a.id
    WHERE c.parent_id IS NOT NULL AND c.parent_id != 0
  )
  SELECT 1 AS hit FROM ancestors
  WHERE id = ?
    OR NOT EXISTS (
      SELECT 1 FROM ancestors a
      LEFT JOIN category c ON c.id = a.id
      WHERE c.id IS NULL OR c.parent_id IS NULL OR c.parent_id = 0
    )
  LIMIT 1
`;
async function wouldCreateCycle(db, categoryId, parentId) {
  const targetId = Number.isFinite(Number(categoryId)) ? Number(categoryId) : categoryId;
  const hit = await db.prepare(ANCESTOR_HIT_SQL).bind(parentId, targetId).first();
  return Boolean(hit);
}
__name(wouldCreateCycle, "wouldCreateCycle");
var CYCLE_GUARD_ERROR_PATTERN = new RegExp(
  `(?:^|:\\s*)${CATEGORY_CYCLE_GUARD_ERROR}(?=:|\\s|$)`
);
function isCycleGuardError(error) {
  return CYCLE_GUARD_ERROR_PATTERN.test(String(error?.message || "").trim());
}
__name(isCycleGuardError, "isCycleGuardError");
async function onRequestPut(context) {
  const { request, env, params } = context;
  const categoryId = decodeURIComponent(params.id);
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const body = await request.json();
    if (!categoryId) {
      return errorResponse("Category id is required", 400);
    }
    if (body && body.reset) {
      const hasChildren = await env.NAV_DB.prepare("SELECT id FROM category WHERE parent_id = ? LIMIT 1").bind(categoryId).first();
      if (hasChildren) {
        return errorResponse("\u65E0\u6CD5\u5220\u9664\uFF1A\u8BE5\u5206\u7C7B\u5305\u542B\u5B50\u5206\u7C7B\uFF0C\u8BF7\u5148\u5220\u9664\u6216\u79FB\u52A8\u5B50\u5206\u7C7B", 400);
      }
      const hasSites = await env.NAV_DB.prepare("SELECT id FROM sites WHERE catelog_id = ? LIMIT 1").bind(categoryId).first();
      if (hasSites) {
        return errorResponse("\u65E0\u6CD5\u5220\u9664\uFF1A\u8BE5\u5206\u7C7B\u5305\u542B\u4E66\u7B7E\uFF0C\u8BF7\u5148\u5220\u9664\u6216\u79FB\u52A8\u4E66\u7B7E", 400);
      }
      await env.NAV_DB.prepare("DELETE FROM category WHERE id = ?").bind(categoryId).run();
      await markHomeCacheDirty(env, "all");
      return jsonResponse({
        code: 200,
        message: "Category deleted successfully"
      });
    }
    const categoryNameResult = normalizeCategoryName(body.catelog);
    let { sort_order } = body;
    if (!categoryNameResult.ok) {
      return errorResponse(categoryNameResult.message, 400);
    }
    const catelog = categoryNameResult.value;
    const parentId = body.parent_id !== void 0 ? parseInt(body.parent_id, 10) : 0;
    if (parentId !== 0 && String(parentId) === String(categoryId)) {
      return errorResponse("\u5206\u7C7B\u4E0D\u80FD\u8BBE\u4E3A\u81EA\u8EAB\u7684\u5B50\u5206\u7C7B", 400);
    }
    let parentCategory = null;
    if (parentId !== 0) {
      parentCategory = await env.NAV_DB.prepare("SELECT id, is_private FROM category WHERE id = ?").bind(parentId).first();
      if (!parentCategory) {
        return errorResponse("\u7236\u5206\u7C7B\u4E0D\u5B58\u5728", 400);
      }
      if (await wouldCreateCycle(env.NAV_DB, categoryId, parentId)) {
        return errorResponse("\u4E0D\u5141\u8BB8\u521B\u5EFA\u5FAA\u73AF\u5F15\u7528\u7684\u5206\u7C7B\u5C42\u7EA7", 400);
      }
    }
    const existingCategory = await env.NAV_DB.prepare("SELECT id FROM category WHERE catelog = ? AND parent_id = ? AND id != ?").bind(catelog, parentId, categoryId).first();
    if (existingCategory) {
      return errorResponse("\u8BE5\u5206\u7C7B\u540D\u79F0\u5728\u5F53\u524D\u7236\u5206\u7C7B\u4E0B\u5DF2\u5B58\u5728", 409);
    }
    sort_order = normalizeSortOrder(sort_order);
    const isPrivate = parentCategory?.is_private === 1 ? 1 : body.is_private ? 1 : 0;
    const batchStmts = [
      env.NAV_DB.prepare("UPDATE category SET catelog = ?, sort_order = ?, parent_id = ?, is_private = ? WHERE id = ?").bind(catelog, sort_order, parentId, isPrivate, categoryId),
      env.NAV_DB.prepare("UPDATE sites SET catelog_name = ? WHERE catelog_id = ?").bind(catelog, categoryId)
    ];
    if (isPrivate === 1) {
      batchStmts.push(...buildPrivateDescendantStatements(env.NAV_DB, categoryId));
    }
    await env.NAV_DB.batch(batchStmts);
    await markHomeCacheDirty(env, "all");
    return jsonResponse({
      code: 200,
      message: "Category updated successfully"
    });
  } catch (e) {
    if (isCycleGuardError(e)) {
      return errorResponse("\u4E0D\u5141\u8BB8\u521B\u5EFA\u5FAA\u73AF\u5F15\u7528\u7684\u5206\u7C7B\u5C42\u7EA7", 400);
    }
    console.error("Failed to process category request:", e);
    return errorResponse(`Failed to process category request: ${e.message}`, 500);
  }
}
__name(onRequestPut, "onRequestPut");

// api/config/[id].js
async function onRequestGet3(context) {
  const { request, env, params } = context;
  const id = params.id;
  const { results } = await env.NAV_DB.prepare("SELECT * FROM sites WHERE id = ?").bind(id).all();
  if (results.length === 0) {
    return errorResponse("config not found", 404);
  }
  const config = results[0];
  if (config.is_private && !await isAdminAuthenticated(request, env)) {
    return errorResponse("config not found", 404);
  }
  return jsonResponse({
    code: 200,
    data: config
  });
}
__name(onRequestGet3, "onRequestGet");
async function onRequestPut2(context) {
  const { request, env, params } = context;
  const id = params.id;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const existing = await env.NAV_DB.prepare("SELECT id, is_private FROM sites WHERE id = ?").bind(id).first();
    if (!existing) {
      return errorResponse("config not found", 404);
    }
    const config = await request.json();
    const { name, url, logo, desc, catelog_id, sort_order, is_private } = config;
    const nameResult = normalizeBookmarkName(name);
    if (!nameResult.ok) return errorResponse(nameResult.message, 400);
    const urlResult = normalizeBookmarkUrl(url);
    if (!urlResult.ok) return errorResponse(urlResult.message, 400);
    const logoResult = normalizeBookmarkLogo(logo, { nullIfEmpty: true });
    if (!logoResult.ok) return errorResponse(logoResult.message, 400);
    const descResult = normalizeBookmarkDesc(desc, { nullIfEmpty: true });
    if (!descResult.ok) return errorResponse(descResult.message, 400);
    const sanitizedName = nameResult.value;
    const rawUrl = urlResult.value;
    const sanitizedUrl = normalizeUrlForStorage(rawUrl);
    let sanitizedLogo = logoResult.value;
    const sanitizedDesc = descResult.value;
    const sortOrderValue = normalizeSortOrder(sort_order);
    const isPrivateValue = is_private ? 1 : 0;
    if (!catelog_id) {
      return errorResponse("Catelog is required", 400);
    }
    if (!sanitizedUrl) {
      return errorResponse("URL must be a valid http or https URL", 400);
    }
    const urlCandidates = getUrlMatchCandidates(rawUrl);
    const placeholders = urlCandidates.map(() => "?").join(",");
    const duplicate = await env.NAV_DB.prepare(`SELECT id FROM sites WHERE url IN (${placeholders}) AND id != ?`).bind(...urlCandidates, id).first();
    if (duplicate) {
      return errorResponse("\u8BE5 URL \u5DF2\u5B58\u5728\uFF0C\u8BF7\u52FF\u91CD\u590D\u6DFB\u52A0", 409);
    }
    const iconAPI = env.ICON_API || "https://faviconsnap.com/api/favicon?url=";
    sanitizedLogo = buildFaviconUrl(sanitizedUrl, sanitizedLogo, iconAPI);
    const categoryResult = await env.NAV_DB.prepare("SELECT catelog, is_private FROM category WHERE id = ?").bind(catelog_id).first();
    if (!categoryResult) {
      return errorResponse("Category not found.", 400);
    }
    const catelogName = categoryResult.catelog;
    let finalIsPrivate = isPrivateValue;
    if (categoryResult.is_private === 1) {
      finalIsPrivate = 1;
    }
    const update = await env.NAV_DB.prepare(`
      UPDATE sites
      SET name = ?, url = ?, logo = ?, desc = ?, catelog_id = ?, catelog_name = ?, sort_order = ?, is_private = ?, update_time = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, catelog_id, catelogName, sortOrderValue, finalIsPrivate, id).run();
    const dirtyScope = existing.is_private === 1 && finalIsPrivate === 1 ? "private" : "all";
    await markHomeCacheDirty(env, dirtyScope);
    return jsonResponse({
      code: 200,
      message: "Config updated successfully",
      update
    });
  } catch (e) {
    return errorResponse(`Failed to update config: ${e.message}`, 500);
  }
}
__name(onRequestPut2, "onRequestPut");
async function onRequestDelete2(context) {
  const { request, env, params } = context;
  const id = params.id;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const existing = await env.NAV_DB.prepare("SELECT id, is_private FROM sites WHERE id = ?").bind(id).first();
    if (!existing) {
      return errorResponse("config not found", 404);
    }
    const del = await env.NAV_DB.prepare("DELETE FROM sites WHERE id = ?").bind(id).run();
    await markHomeCacheDirty(env, existing.is_private ? "private" : "all");
    return jsonResponse({
      code: 200,
      message: "Config deleted successfully",
      del
    });
  } catch (e) {
    return errorResponse(`Failed to delete config: ${e.message}`, 500);
  }
}
__name(onRequestDelete2, "onRequestDelete");

// api/pending/[id].js
async function onRequestPut3(context) {
  const { request, env, params } = context;
  const id = params.id;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const { results } = await env.NAV_DB.prepare("SELECT * FROM pending_sites WHERE id = ?").bind(id).all();
    if (results.length === 0) {
      return errorResponse("Pending config not found", 404);
    }
    const config = results[0];
    let updateData = {};
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      try {
        updateData = await request.json();
      } catch {
        updateData = {};
      }
    }
    if (!updateData || typeof updateData !== "object" || Array.isArray(updateData)) {
      updateData = {};
    }
    const hasField = /* @__PURE__ */ __name((field) => Object.prototype.hasOwnProperty.call(updateData, field), "hasField");
    const getField = /* @__PURE__ */ __name((field, fallback) => hasField(field) ? updateData[field] : fallback, "getField");
    const catelogId = hasField("catelog_id") ? updateData.catelog_id : getField("catelogId", config.catelog_id);
    const nameResult = normalizeBookmarkName(getField("name", config.name));
    if (!nameResult.ok) return errorResponse(nameResult.message, 400);
    const urlResult = normalizeBookmarkUrl(getField("url", config.url));
    if (!urlResult.ok) return errorResponse(urlResult.message, 400);
    const logoResult = normalizeBookmarkLogo(getField("logo", config.logo), { nullIfEmpty: true });
    if (!logoResult.ok) return errorResponse(logoResult.message, 400);
    const descResult = normalizeBookmarkDesc(getField("desc", config.desc), { nullIfEmpty: true });
    if (!descResult.ok) return errorResponse(descResult.message, 400);
    const sanitizedName = nameResult.value;
    const rawUrl = urlResult.value;
    const sanitizedUrl = normalizeUrlForStorage(rawUrl);
    let sanitizedLogo = logoResult.value;
    const sanitizedDesc = descResult.value;
    const sortOrderValue = hasField("sort_order") ? normalizeSortOrder(updateData.sort_order) : 9999;
    const isPrivateValue = getField("is_private", false) ? 1 : 0;
    if (!catelogId) {
      return errorResponse("Catelog is required", 400);
    }
    if (!sanitizedUrl) {
      return errorResponse("URL must be a valid http or https URL", 400);
    }
    const urlCandidates = getUrlMatchCandidates(rawUrl);
    const placeholders = urlCandidates.map(() => "?").join(",");
    const duplicate = await env.NAV_DB.prepare(`SELECT id FROM sites WHERE url IN (${placeholders})`).bind(...urlCandidates).first();
    if (duplicate) {
      return errorResponse("\u8BE5 URL \u5DF2\u5B58\u5728\uFF0C\u8BF7\u52FF\u91CD\u590D\u6DFB\u52A0", 409);
    }
    const iconAPI = env.ICON_API || "https://faviconsnap.com/api/favicon?url=";
    sanitizedLogo = buildFaviconUrl(sanitizedUrl, sanitizedLogo, iconAPI);
    const category = await env.NAV_DB.prepare("SELECT catelog, is_private FROM category WHERE id = ?").bind(catelogId).first();
    if (!category) {
      return errorResponse("Category not found.", 400);
    }
    const finalIsPrivate = category.is_private === 1 ? 1 : isPrivateValue;
    await env.NAV_DB.batch([
      env.NAV_DB.prepare(`
        INSERT INTO sites (name, url, logo, desc, catelog_id, catelog_name, sort_order, is_private)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, catelogId, category.catelog, sortOrderValue, finalIsPrivate),
      env.NAV_DB.prepare("DELETE FROM pending_sites WHERE id = ?").bind(id)
    ]);
    await markHomeCacheDirty(env, finalIsPrivate ? "private" : "all");
    return jsonResponse({
      code: 200,
      message: "Pending config approved successfully"
    });
  } catch (e) {
    console.error("Error approving pending config:", e);
    return errorResponse(`Failed to approve pending config: ${e.message}`, 500);
  }
}
__name(onRequestPut3, "onRequestPut");
async function onRequestDelete3(context) {
  const { request, env, params } = context;
  const id = params.id;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const result = await env.NAV_DB.prepare("DELETE FROM pending_sites WHERE id = ?").bind(id).run();
    if (result?.meta?.changes === 0) {
      return errorResponse("Pending config not found", 404);
    }
    return jsonResponse({
      code: 200,
      message: "Pending config rejected successfully"
    });
  } catch (e) {
    return errorResponse(`Failed to reject pending config: ${e.message}`, 500);
  }
}
__name(onRequestDelete3, "onRequestDelete");

// admin/login.js
async function createAdminSession(env, ttl = 86400) {
  const token = crypto.randomUUID();
  await env.NAV_AUTH.put(`session_${token}`, Date.now().toString(), { expirationTtl: ttl });
  return token;
}
__name(createAdminSession, "createAdminSession");
var MAX_LOGIN_ATTEMPTS = 5;
var LOCKOUT_SECONDS = 600;
var ALLOWED_LOGIN_DURATIONS = /* @__PURE__ */ new Set([1, 7, 30, 60, 90]);
function renderLoginPage(message = "", env = {}) {
  const hasError = Boolean(message);
  const safeMessage = hasError ? escapeHTML(message) : "";
  const siteName = escapeHTML(env.SITE_NAME || "\u6211\u7684\u5BFC\u822A");
  const { siteKey, isConfigured, isComplete } = getTurnstileConfig(env);
  const shouldRenderTurnstile = isConfigured && siteKey;
  const turnstileScript = shouldRenderTurnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer><\/script>' : "";
  const turnstileWidget = shouldRenderTurnstile ? `<div class="form-group turnstile-group"><div class="cf-turnstile" data-sitekey="${escapeHTML(siteKey)}" data-theme="light" data-size="flexible"></div></div>` : "";
  const configWarning = isConfigured && !isComplete ? '<div class="error-message" role="alert">Turnstile \u914D\u7F6E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u540C\u65F6\u8BBE\u7F6E Site Key \u548C Secret Key</div>' : "";
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\u7BA1\u7406\u5458\u767B\u5F55 \xB7 ${siteName}</title>
  <meta name="theme-color" content="#f6f4fb">
  <link rel="icon" href="/favicon.svg?v=148aafdf" type="image/svg+xml">
  <link rel="stylesheet" href="/css/login.css?v=5a8cff09">
  <script src="/js/login.js?v=72d49e8f" defer><\/script>
  ${turnstileScript}
</head>
<body>
  <svg class="icon-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <symbol id="icon-bookmark" viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4V4Z"/></symbol>
    <symbol id="icon-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol>
    <symbol id="icon-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></symbol>
    <symbol id="icon-lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></symbol>
    <symbol id="icon-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></symbol>
    <symbol id="icon-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
    <symbol id="icon-chevron" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></symbol>
    <symbol id="icon-spark" viewBox="0 0 24 24"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></symbol>
  </svg>
  <div class="page-shell">
    <header class="page-header">
      <a href="/" class="brand" aria-label="${siteName}\u9996\u9875">
        <span class="brand-mark"><svg class="icon"><use href="#icon-bookmark"/></svg></span>
        <span>${siteName}<small>IORI NAV</small></span>
      </a>
      <a href="/" class="back-link"><span aria-hidden="true">\u2190</span> \u8FD4\u56DE\u9996\u9875</a>
    </header>
    <main class="login-layout">
      <section class="intro" aria-labelledby="intro-title">
        <p class="eyebrow"><span></span> \u4F60\u7684\u4E16\u754C\uFF0C\u4E95\u7136\u6709\u5E8F</p>
        <h2 id="intro-title">\u6536\u85CF\u6BCF\u4E00\u4EFD\u7075\u611F\uFF0C<br><span>\u7559\u4E0B\u81EA\u5DF1\u7684\u8F68\u8FF9\u3002</span></h2>
        <p class="intro-description">\u8BA9\u6563\u843D\u7684\u597D\u7F51\u7AD9\u6709\u5904\u53EF\u5F52\u3002<br>\u4ECE\u8FD9\u91CC\uFF0C\u7EE7\u7EED\u6574\u7406\u4F60\u559C\u6B22\u7684\u4E16\u754C\u3002</p>
        <div class="bookmark-scene" aria-hidden="true">
          <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
          <span class="scene-dot dot-one"></span><span class="scene-dot dot-two"></span>
          <div class="collection-window">
            <div class="window-bar"><span class="window-dots"><i></i><i></i><i></i></span><span>\u6211\u7684\u6536\u85CF\u5939</span><svg class="icon"><use href="#icon-bookmark"/></svg></div>
            <div class="window-content">
              <p class="collection-label">\u4E3A\u70ED\u7231\uFF0C\u7559\u4E00\u4E2A\u4F4D\u7F6E</p>
              <div class="collection-row"><span class="tile-icon tile-purple"><svg class="icon"><use href="#icon-spark"/></svg></span><span><b>\u7075\u611F\u4E0E\u521B\u610F</b><small>\u8BA9\u597D\u60F3\u6CD5\u968F\u65F6\u53D1\u751F</small></span><span class="row-arrow">\u2197</span></div>
              <div class="collection-row"><span class="tile-icon tile-blue"><svg class="icon"><use href="#icon-bookmark"/></svg></span><span><b>\u9605\u8BFB\u4E0E\u63A2\u7D22</b><small>\u603B\u6709\u65B0\u7684\u4E16\u754C\u503C\u5F97\u53D1\u73B0</small></span><span class="row-arrow">\u2197</span></div>
              <div class="collection-row"><span class="tile-icon tile-peach"><svg class="icon"><use href="#icon-clock"/></svg></span><span><b>\u65E5\u5E38\u4E0E\u6548\u7387</b><small>\u628A\u65F6\u95F4\u7559\u7ED9\u91CD\u8981\u7684\u4E8B</small></span><span class="row-arrow">\u2197</span></div>
            </div>
          </div>
          <div class="floating-bookmark"><svg class="icon"><use href="#icon-bookmark"/></svg></div>
          <div class="saved-note"><span>\u2713</span> \u7F8E\u597D\uFF0C\u5DF2\u6536\u85CF</div>
          <svg class="scene-spark icon"><use href="#icon-spark"/></svg>
        </div>
        <p class="intro-footnote"><span></span> \u4E00\u4E2A\u5C5E\u4E8E\u4F60\u7684\u4E92\u8054\u7F51\u89D2\u843D</p>
      </section>
      <section class="login-container" aria-labelledby="login-title">
        <div class="form-heading">
          <span class="welcome-label">WELCOME BACK</span>
          <h1 class="login-title" id="login-title">\u7BA1\u7406\u5458\u767B\u5F55</h1>
          <p>\u6B22\u8FCE\u56DE\u6765\uFF0C\u7EE7\u7EED\u6253\u7406\u4F60\u7684\u4E66\u7B7E\u6536\u85CF\u3002</p>
        </div>
        <form method="post" action="/admin/login" novalidate>
          <div class="form-group">
            <label for="username">\u7528\u6237\u540D</label>
            <div class="input-wrap">
              <svg class="icon input-icon" aria-hidden="true"><use href="#icon-user"/></svg>
              <input type="text" id="username" name="username" required autocomplete="username" placeholder="\u8BF7\u8F93\u5165\u7528\u6237\u540D" autofocus>
            </div>
          </div>
          <div class="form-group">
            <label for="password">\u5BC6\u7801</label>
            <div class="input-wrap">
              <svg class="icon input-icon" aria-hidden="true"><use href="#icon-lock"/></svg>
              <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="\u8BF7\u8F93\u5165\u5BC6\u7801">
              <button type="button" class="password-toggle" id="passwordToggle" aria-label="\u663E\u793A\u5BC6\u7801" aria-pressed="false" aria-controls="password" hidden>
                <svg class="icon" aria-hidden="true"><use href="#icon-eye"/><path class="eye-slash" d="m3 3 18 18"/></svg>
              </button>
            </div>
          </div>
          <div class="form-group">
            <label for="duration" class="duration-label">\u767B\u5F55\u6709\u6548\u671F <span>\u6309\u4F60\u7684\u4F7F\u7528\u4E60\u60EF\u9009\u62E9</span></label>
            <div class="input-wrap">
              <svg class="icon input-icon" aria-hidden="true"><use href="#icon-clock"/></svg>
              <select id="duration" name="duration" aria-describedby="duration-hint">
                <option value="1">1 \u5929</option>
                <option value="7">7 \u5929</option>
                <option value="30">30 \u5929</option>
                <option value="60">60 \u5929</option>
                <option value="90">90 \u5929</option>
              </select>
              <svg class="icon select-chevron" aria-hidden="true"><use href="#icon-chevron"/></svg>
            </div>
            <p id="duration-hint" class="field-hint">\u516C\u5171\u8BBE\u5907\u5EFA\u8BAE\u9009\u62E9 1 \u5929\uFF0C\u5E76\u5728\u4F7F\u7528\u540E\u9000\u51FA\u3002</p>
          </div>
          ${turnstileWidget}
          ${configWarning}
          ${hasError ? `<div class="error-message" role="alert">${safeMessage}</div>` : ""}
          <button type="submit" class="login-button"><span class="button-label">\u767B \u5F55</span><svg class="icon" aria-hidden="true"><use href="#icon-arrow"/></svg></button>
        </form>
        <div class="form-footer"><svg class="icon" aria-hidden="true"><use href="#icon-lock"/></svg><span>\u4EC5\u9650\u7BA1\u7406\u5458\u8BBF\u95EE \xB7 \u59A5\u5584\u4FDD\u7BA1\u4F60\u7684\u8D26\u53F7</span></div>
      </section>
    </main>
    <footer class="page-footer"><span>${siteName}</span><span>\u628A\u559C\u6B22\u7684\u4E16\u754C\uFF0C\u7559\u5728\u8FD9\u91CC\u3002</span></footer>
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
__name(renderLoginPage, "renderLoginPage");
async function onRequestGet4(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  return renderLoginPage(error || "", env);
}
__name(onRequestGet4, "onRequestGet");
async function onRequestPost8(context) {
  const { request, env } = context;
  try {
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
    const { locked } = await checkLoginRateLimit(env, ip, MAX_LOGIN_ATTEMPTS, LOCKOUT_SECONDS);
    if (locked) {
      return renderLoginPage("\u767B\u5F55\u5C1D\u8BD5\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7 10 \u5206\u949F\u540E\u518D\u8BD5", env);
    }
    const formData = await request.formData();
    const name = (formData.get("username") || "").trim();
    const rawPassword = formData.get("password");
    const password = typeof rawPassword === "string" ? rawPassword : "";
    const durationDays = Number(formData.get("duration") || "1");
    if (!ALLOWED_LOGIN_DURATIONS.has(durationDays)) {
      return renderLoginPage("\u767B\u5F55\u6709\u6548\u671F\u65E0\u6548", env);
    }
    const ttl = durationDays * 86400;
    const turnstileToken = String(formData.get("cf-turnstile-response") || "").trim();
    if (!name || !password) {
      return renderLoginPage("\u8BF7\u8F93\u5165\u7528\u6237\u540D\u548C\u5BC6\u7801", env);
    }
    const turnstileResult = await verifyTurnstileToken(turnstileToken, env, ip);
    if (!turnstileResult.ok) {
      return renderLoginPage(turnstileResult.message, env);
    }
    const storedUsername = await env.NAV_AUTH.get("admin_username");
    const storedPassword = await env.NAV_AUTH.get("admin_password");
    if (!storedUsername || !storedPassword) {
      console.error("Admin credentials not found in KV");
      return renderLoginPage("\u7CFB\u7EDF\u914D\u7F6E\u9519\u8BEF\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458", env);
    }
    if (storedUsername.length > MAX_TIMING_SAFE_INPUT_LENGTH || storedPassword.length > MAX_TIMING_SAFE_INPUT_LENGTH) {
      console.error(`Admin credentials exceed the supported length (${MAX_TIMING_SAFE_INPUT_LENGTH} characters)`);
      return renderLoginPage("\u7CFB\u7EDF\u914D\u7F6E\u9519\u8BEF\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458", env);
    }
    const usernameValid = timingSafeEqual(name, storedUsername);
    const passwordValid = timingSafeEqual(password, storedPassword);
    const isValid = usernameValid && passwordValid;
    if (isValid) {
      await clearLoginFailures(env, ip);
      const token = await createAdminSession(env, ttl);
      const csrfToken = crypto.randomUUID();
      await env.NAV_AUTH.put(`csrf_${token}`, csrfToken, { expirationTtl: ttl });
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/admin",
          "Set-Cookie": buildSessionCookie(token, { maxAge: ttl })
        }
      });
    }
    await recordLoginFailure(env, ip, MAX_LOGIN_ATTEMPTS, LOCKOUT_SECONDS);
    return renderLoginPage("\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5", env);
  } catch (e) {
    console.error("Login error:", e);
    return renderLoginPage("\u767B\u5F55\u5904\u7406\u51FA\u9519\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", env);
  }
}
__name(onRequestPost8, "onRequestPost");

// lib/workers-ai-models.js
var DEFAULT_WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";
function normalizeWorkersAiModel(model) {
  const value = String(model ?? "").trim();
  if (!value) return "";
  if (!validateOpaqueText(value, 200).ok) return "";
  if (!value.startsWith("@cf/")) return "";
  return value;
}
__name(normalizeWorkersAiModel, "normalizeWorkersAiModel");
function resolveWorkersAiModel(...candidates) {
  for (const candidate of candidates) {
    const model = normalizeWorkersAiModel(candidate);
    if (model) return model;
  }
  return DEFAULT_WORKERS_AI_MODEL;
}
__name(resolveWorkersAiModel, "resolveWorkersAiModel");

// api/ai-chat.js
var AI_REQUEST_TIMEOUT_MS = 25e3;
var AI_MAX_MESSAGES = 50;
var AI_MAX_TOTAL_CHARS = 1e5;
var AI_MAX_BODY_BYTES = 256 * 1024;
function runWithTimeout(promise, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("AI request timed out");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
__name(runWithTimeout, "runWithTimeout");
async function readBodyWithLimit(request, maxBytes) {
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {
        });
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {
    });
    console.warn("Failed to read AI request body:", e);
    return { failed: true };
  }
  if (chunks.length === 0) return { text: "" };
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged) };
}
__name(readBodyWithLimit, "readBodyWithLimit");
function getMessageContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (typeof part?.text === "string") return part.text;
    return "";
  }).join("");
}
__name(getMessageContentText, "getMessageContentText");
function extractWorkersAiText(response) {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  if (typeof response.response === "string") {
    return response.response;
  }
  const choiceContent = response.choices?.[0]?.message?.content;
  const choiceText = getMessageContentText(choiceContent);
  if (choiceText) return choiceText;
  if (typeof response.result?.response === "string") {
    return response.result.response;
  }
  return "";
}
__name(extractWorkersAiText, "extractWorkersAiText");
function stripMarkdownFence(text) {
  return String(text || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
}
__name(stripMarkdownFence, "stripMarkdownFence");
function stripEnclosingQuotes(text) {
  return String(text || "").trim().replace(/^[\s"'“”‘’`]+/, "").replace(/[\s"'“”‘’`]+$/, "").trim();
}
__name(stripEnclosingQuotes, "stripEnclosingQuotes");
function sanitizeDescriptionCandidate(candidate) {
  return stripEnclosingQuotes(candidate).replace(/^(?:[-*•]|\d+[.)、])\s*/, "").replace(/^(?:最终(?:答案|描述|结果)|答案|描述|简介|Selected description)\s*[:：]\s*/i, "").trim();
}
__name(sanitizeDescriptionCandidate, "sanitizeDescriptionCandidate");
function isLikelyDescription(candidate) {
  const text = sanitizeDescriptionCandidate(candidate);
  if (!text || text.length < 4 || text.length > 80) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (!/[\u4e00-\u9fffA-Za-z]/.test(text)) return false;
  if (/(我需要|首先|然后|接下来|因此|可能|假设|分析|检查字数|用户|书签名称|链接是|不超过|生成|例如|或者|考虑到|所以)/.test(text)) {
    return false;
  }
  return true;
}
__name(isLikelyDescription, "isLikelyDescription");
function parseJsonDescription(text) {
  try {
    const parsed = JSON.parse(stripMarkdownFence(text));
    if (typeof parsed?.description === "string") {
      return sanitizeDescriptionCandidate(parsed.description);
    }
  } catch {
  }
  return "";
}
__name(parseJsonDescription, "parseJsonDescription");
function normalizeBookmarkJson(parsed) {
  if (!parsed || typeof parsed !== "object" || typeof parsed.description !== "string") {
    return "";
  }
  const name = stripEnclosingQuotes(parsed.name || "");
  const description = sanitizeDescriptionCandidate(parsed.description);
  if (!description) return "";
  return JSON.stringify({
    name: name.slice(0, 20),
    description
  });
}
__name(normalizeBookmarkJson, "normalizeBookmarkJson");
function extractBookmarkJson(text) {
  const content = stripMarkdownFence(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    const normalized = normalizeBookmarkJson(JSON.parse(content));
    if (normalized) return normalized;
  } catch {
  }
  const matches = content.match(/\{[\s\S]*?\}/g) || [];
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const normalized = normalizeBookmarkJson(JSON.parse(matches[i]));
      if (normalized) return normalized;
    } catch {
    }
  }
  return "";
}
__name(extractBookmarkJson, "extractBookmarkJson");
function extractLabeledDescription(text) {
  const pattern = /(?:最终(?:答案|描述|结果)|答案|描述|简介|Selected description)\s*[:：]\s*([^\n]+)/gi;
  let match2;
  let candidate = "";
  while ((match2 = pattern.exec(text)) !== null) {
    candidate = match2[1];
  }
  candidate = sanitizeDescriptionCandidate(candidate);
  return isLikelyDescription(candidate) ? candidate : "";
}
__name(extractLabeledDescription, "extractLabeledDescription");
function extractQuotedDescription(text) {
  const pattern = /["“‘]([^"”’\n]{4,80})["”’]?/g;
  let match2;
  let candidate = "";
  while ((match2 = pattern.exec(text)) !== null) {
    const value = sanitizeDescriptionCandidate(match2[1]);
    if (isLikelyDescription(value)) {
      candidate = value;
    }
  }
  return candidate;
}
__name(extractQuotedDescription, "extractQuotedDescription");
function extractLineDescription(text) {
  const lines = text.split(/\r?\n/).map((line) => sanitizeDescriptionCandidate(line)).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isLikelyDescription(lines[i])) return lines[i];
  }
  return "";
}
__name(extractLineDescription, "extractLineDescription");
function extractBookmarkDescription(text) {
  const content = stripMarkdownFence(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const wholeContent = sanitizeDescriptionCandidate(content);
  return parseJsonDescription(content) || extractLabeledDescription(content) || extractQuotedDescription(content) || extractLineDescription(content) || (isLikelyDescription(wholeContent) ? wholeContent : "");
}
__name(extractBookmarkDescription, "extractBookmarkDescription");
function formatAiContent(content, responseFormat) {
  if (responseFormat === "bookmark-description") {
    return extractBookmarkDescription(content);
  }
  if (responseFormat === "bookmark-json") {
    return extractBookmarkJson(content);
  }
  return content;
}
__name(formatAiContent, "formatAiContent");
async function onRequestPost9(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const declaredBytes = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > AI_MAX_BODY_BYTES) {
      return errorResponse("Request body too large", 413);
    }
    const bodyResult = await readBodyWithLimit(request, AI_MAX_BODY_BYTES);
    if (bodyResult.tooLarge) {
      return errorResponse("Request body too large", 413);
    }
    if (bodyResult.failed) {
      return errorResponse("Failed to read request body", 400);
    }
    let payload;
    try {
      payload = JSON.parse(bodyResult.text);
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    const { messages, responseFormat } = payload && typeof payload === "object" ? payload : {};
    if (!messages || !Array.isArray(messages)) {
      return errorResponse("Messages array is required", 400);
    }
    if (messages.length > AI_MAX_MESSAGES) {
      return errorResponse(`Messages cannot exceed ${AI_MAX_MESSAGES} entries`, 400);
    }
    const totalChars = JSON.stringify(messages).length;
    if (totalChars > AI_MAX_TOTAL_CHARS) {
      return errorResponse(`Messages cannot exceed ${AI_MAX_TOTAL_CHARS} characters`, 413);
    }
    const keys = ["provider", "apiKey", "baseUrl", "model"];
    const { results } = await env.NAV_DB.prepare(
      `SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`
    ).bind(...keys).all();
    const settings = {};
    if (results) {
      results.forEach((row) => {
        settings[row.key] = row.value;
      });
    }
    const provider = settings.provider || "workers-ai";
    const apiKey = settings.apiKey;
    const baseUrl = settings.baseUrl;
    const model = settings.model;
    if (provider === "workers-ai") {
      if (!env.AI) {
        return errorResponse("Workers AI binding (env.AI) not found", 500);
      }
      const workerModel = resolveWorkersAiModel(model, env.WORKERS_AI_MODEL);
      const response = await runWithTimeout(env.AI.run(workerModel, { messages }));
      const content = formatAiContent(extractWorkersAiText(response), responseFormat);
      if (!content) {
        return errorResponse("Workers AI response did not include generated content", 500);
      }
      return jsonResponse({
        code: 200,
        data: content
      });
    } else if (provider === "openai") {
      if (!apiKey) return errorResponse("OpenAI API Key \u672A\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E", 500);
      if (!baseUrl) return errorResponse("OpenAI Base URL \u672A\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E", 500);
      const openaiUrl = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
      const aiResponse = await fetch(openaiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model: model || "gpt-3.5-turbo",
          messages,
          temperature: 0.7
        })
      });
      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        return errorResponse(`OpenAI API Error: ${errText}`, 500);
      }
      const data = await aiResponse.json();
      const content = formatAiContent(data.choices?.[0]?.message?.content || "", responseFormat);
      return jsonResponse({
        code: 200,
        data: content
      });
    } else if (provider === "gemini") {
      if (!apiKey) return errorResponse("Gemini API Key \u672A\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E", 500);
      const geminiModel = model || "gemini-1.5-flash";
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
      const contents = messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }]
      }));
      const systemMsg = messages.find((m) => m.role === "system");
      const payload2 = {
        contents,
        generationConfig: { temperature: 0.7 }
      };
      if (systemMsg) {
        payload2.systemInstruction = { parts: [{ text: systemMsg.content }] };
      }
      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        body: JSON.stringify(payload2)
      });
      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        return errorResponse(`Gemini API Error: ${errText}`, 500);
      }
      const data = await aiResponse.json();
      const content = formatAiContent(data.candidates?.[0]?.content?.parts?.[0]?.text || "", responseFormat);
      return jsonResponse({
        code: 200,
        data: content
      });
    } else {
      return errorResponse(`Unsupported provider: ${provider}`, 400);
    }
  } catch (e) {
    console.error("AI Chat API error:", e);
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return errorResponse("AI \u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", 504);
    }
    return errorResponse(`Server Error: ${e.message}`, 500);
  }
}
__name(onRequestPost9, "onRequestPost");

// api/categories/index.js
async function onRequestGet5(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isPublicScope = url.searchParams.get("scope") === "public";
  const isAuthenticated = await isAdminAuthenticated(request, env);
  if ((!isAuthenticated || isPublicScope) && !isSubmissionEnabled(env)) {
    return errorResponse("Unauthorized", 401);
  }
  const shouldShowPublicOnly = isPublicScope || !isAuthenticated;
  const maxPageSize = shouldShowPublicOnly ? 1e3 : 1e4;
  const { page, pageSize, offset } = parsePagination(url.searchParams, { maxPageSize });
  try {
    const categoryFilter = shouldShowPublicOnly ? "WHERE c.is_private = 0" : "";
    const countFilter = shouldShowPublicOnly ? "WHERE is_private = 0" : "";
    const siteJoin = shouldShowPublicOnly ? "LEFT JOIN sites s ON c.id = s.catelog_id AND s.is_private = 0" : "LEFT JOIN sites s ON c.id = s.catelog_id";
    const [{ results }, countResult] = await Promise.all([
      env.NAV_DB.prepare(`
        SELECT c.id, c.catelog, c.sort_order, c.parent_id, c.is_private, COUNT(s.id) AS site_count
        FROM category c
        ${siteJoin}
        ${categoryFilter}
        GROUP BY c.id, c.catelog, c.sort_order, c.parent_id, c.is_private
        ORDER BY c.sort_order ASC, c.create_time DESC
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all(),
      env.NAV_DB.prepare(`
        SELECT COUNT(*) as total FROM category ${countFilter}
      `).first()
    ]);
    const total = countResult ? countResult.total : 0;
    return jsonResponse({
      code: 200,
      data: results,
      total,
      page,
      pageSize
    });
  } catch (e) {
    return errorResponse(`Failed to fetch categories: ${e.message}`, 500);
  }
}
__name(onRequestGet5, "onRequestGet");

// api/config/index.js
var MAX_CONFIG_SEARCH_KEYWORD_LENGTH = 100;
var MAX_PUBLIC_PAGE_SIZE = 200;
var MAX_ADMIN_PAGE_SIZE = 1e4;
async function onRequestGet6(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const catalog = url.searchParams.get("catalog");
  const catalogId = url.searchParams.get("catalogId");
  const keyword = (url.searchParams.get("keyword") || "").trim();
  if (keyword.length > MAX_CONFIG_SEARCH_KEYWORD_LENGTH) {
    return errorResponse(`\u641C\u7D22\u5173\u952E\u8BCD\u4E0D\u80FD\u8D85\u8FC7 ${MAX_CONFIG_SEARCH_KEYWORD_LENGTH} \u4E2A\u5B57\u7B26`, 400);
  }
  const isAuthenticated = await isAdminAuthenticated(request, env);
  const includePrivate = isAuthenticated ? 1 : 0;
  const maxPageSize = isAuthenticated ? MAX_ADMIN_PAGE_SIZE : MAX_PUBLIC_PAGE_SIZE;
  const { page, pageSize, offset } = parsePagination(url.searchParams, { maxPageSize });
  try {
    let queryBase = `FROM sites s WHERE (s.is_private = 0 OR ? = 1)`;
    let queryBindParams = [includePrivate];
    if (catalogId) {
      queryBase += ` AND s.catelog_id = ?`;
      queryBindParams.push(catalogId);
    } else if (catalog) {
      queryBase += ` AND s.catelog_name = ?`;
      queryBindParams.push(catalog);
    }
    if (keyword) {
      const escaped = escapeLikePattern(keyword);
      queryBase += ` AND (name LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR catelog_name LIKE ? ESCAPE '\\' OR s.desc LIKE ? ESCAPE '\\')`;
      queryBindParams.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }
    const query = `SELECT * ${queryBase} ORDER BY sort_order ASC, create_time DESC LIMIT ? OFFSET ?`;
    const countQuery = `SELECT COUNT(*) as total ${queryBase}`;
    const fullBindParams = [...queryBindParams, pageSize, offset];
    const [{ results }, countResult] = await Promise.all([
      env.NAV_DB.prepare(query).bind(...fullBindParams).all(),
      env.NAV_DB.prepare(countQuery).bind(...queryBindParams).first()
    ]);
    const total = countResult ? countResult.total : 0;
    return jsonResponse({
      code: 200,
      data: results,
      total,
      page,
      pageSize
    });
  } catch (e) {
    return errorResponse(`Failed to fetch config data: ${e.message}`, 500);
  }
}
__name(onRequestGet6, "onRequestGet");
async function onRequestPost10(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const config = await request.json();
    const { name, url, logo, desc, catelogId, sort_order, is_private } = config;
    const iconAPI = env.ICON_API || "https://faviconsnap.com/api/favicon?url=";
    const nameResult = normalizeBookmarkName(name);
    if (!nameResult.ok) return errorResponse(nameResult.message, 400);
    const urlResult = normalizeBookmarkUrl(url);
    if (!urlResult.ok) return errorResponse(urlResult.message, 400);
    const logoResult = normalizeBookmarkLogo(logo, { nullIfEmpty: true });
    if (!logoResult.ok) return errorResponse(logoResult.message, 400);
    const descResult = normalizeBookmarkDesc(desc, { nullIfEmpty: true });
    if (!descResult.ok) return errorResponse(descResult.message, 400);
    const sanitizedName = nameResult.value;
    const rawUrl = urlResult.value;
    const sanitizedUrl = normalizeUrlForStorage(rawUrl);
    let sanitizedLogo = logoResult.value;
    const sanitizedDesc = descResult.value;
    const sortOrderValue = normalizeSortOrder(sort_order);
    const isPrivateValue = is_private ? 1 : 0;
    if (!catelogId) {
      return errorResponse("Catelog is required", 400);
    }
    if (!sanitizedUrl) {
      return errorResponse("URL must be a valid http or https URL", 400);
    }
    const urlCandidates = getUrlMatchCandidates(rawUrl);
    const placeholders = urlCandidates.map(() => "?").join(",");
    const existingSite = await env.NAV_DB.prepare(`SELECT id FROM sites WHERE url IN (${placeholders})`).bind(...urlCandidates).first();
    if (existingSite) {
      return errorResponse("\u8BE5 URL \u5DF2\u5B58\u5728\uFF0C\u8BF7\u52FF\u91CD\u590D\u6DFB\u52A0", 409);
    }
    sanitizedLogo = buildFaviconUrl(sanitizedUrl, sanitizedLogo, iconAPI);
    const categoryResult = await env.NAV_DB.prepare("SELECT catelog, is_private FROM category WHERE id = ?").bind(catelogId).first();
    if (!categoryResult) {
      return errorResponse(`Category not found.`, 400);
    }
    let finalIsPrivate = isPrivateValue;
    if (categoryResult.is_private === 1) {
      finalIsPrivate = 1;
    }
    const insert = await env.NAV_DB.prepare(`
      INSERT INTO sites (name, url, logo, desc, catelog_id, catelog_name, sort_order, is_private)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, catelogId, categoryResult.catelog, sortOrderValue, finalIsPrivate).run();
    await markHomeCacheDirty(env, finalIsPrivate ? "private" : "all");
    return jsonResponse({
      code: 201,
      message: "Config created successfully",
      insert
    }, 201);
  } catch (e) {
    return errorResponse(`Failed to create config: ${e.message}`, 500);
  }
}
__name(onRequestPost10, "onRequestPost");

// api/get-empty-desc-sites.js
async function onRequestGet7(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const { results } = await env.NAV_DB.prepare(
      "SELECT id, name, url , logo FROM sites WHERE desc IS NULL OR desc = ''"
    ).all();
    return jsonResponse({
      code: 200,
      data: results
    });
  } catch (e) {
    console.error("Error fetching sites with empty description:", e);
    return errorResponse(`Failed to fetch sites: ${e.message}`, 500);
  }
}
__name(onRequestGet7, "onRequestGet");

// api/graph.js
var GRAPH_TOTAL_NODE_LIMIT = 600;
var GRAPH_CATEGORY_LIMIT = 300;
var GRAPH_SITE_LIMIT = 600;
var GRAPH_CACHE_KEY_PREFIX = "graph_cache_";
var GRAPH_CACHE_TTL = 300;
async function onRequestGet8(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  const generation = await getGraphCacheGeneration(env);
  const cacheKey = generation ? `${GRAPH_CACHE_KEY_PREFIX}${generation}` : null;
  if (cacheKey) {
    try {
      const cached = await env.NAV_AUTH.get(cacheKey);
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Cache": "HIT"
          }
        });
      }
    } catch (e) {
      console.warn("Graph cache read failed:", e);
    }
  }
  try {
    let getCategoryLevel = function(cat, visited = /* @__PURE__ */ new Set()) {
      if (levelCache.has(cat.id)) return levelCache.get(cat.id);
      if (!cat.parent_id || !catById.has(cat.parent_id) || visited.has(cat.id)) {
        levelCache.set(cat.id, 1);
        return 1;
      }
      visited.add(cat.id);
      const lvl = getCategoryLevel(catById.get(cat.parent_id), visited) + 1;
      levelCache.set(cat.id, lvl);
      return lvl;
    };
    __name(getCategoryLevel, "getCategoryLevel");
    const categoryQuery = `SELECT id, catelog, parent_id FROM category ORDER BY sort_order ASC, id ASC LIMIT ${GRAPH_CATEGORY_LIMIT}`;
    const categoryCountQuery = "SELECT COUNT(*) AS total FROM category";
    const [categoriesResult, categoryCountResult] = await Promise.all([
      env.NAV_DB.prepare(categoryQuery).all(),
      env.NAV_DB.prepare(categoryCountQuery).first()
    ]);
    const categories = categoriesResult.results || [];
    const totalCategories = Number(categoryCountResult?.total || 0);
    const siteLimit = Math.max(0, GRAPH_TOTAL_NODE_LIMIT - categories.length);
    const categoryIds = new Set(categories.map((c) => c.id));
    const nodes = [];
    const edges = [];
    const catById = new Map(categories.map((c) => [c.id, c]));
    const levelCache = /* @__PURE__ */ new Map();
    for (const cat of categories) {
      nodes.push({
        id: `cat:${cat.id}`,
        title: cat.catelog,
        kind: "category",
        level: getCategoryLevel(cat)
      });
      if (cat.parent_id && categoryIds.has(cat.parent_id)) {
        edges.push({ source: `cat:${cat.parent_id}`, target: `cat:${cat.id}` });
      }
    }
    let totalSites = 0;
    let sites = [];
    if (categoryIds.size > 0 && siteLimit > 0) {
      const categorySubquery = `SELECT id FROM category ORDER BY sort_order ASC, id ASC LIMIT ${GRAPH_CATEGORY_LIMIT}`;
      const sitesQuery = `SELECT s.id, s.name, s.url, s.logo, s.catelog_id
        FROM sites s
        WHERE s.catelog_id IN (${categorySubquery})
        ORDER BY s.sort_order ASC, s.id ASC
        LIMIT ${GRAPH_SITE_LIMIT}`;
      const siteCountQuery = `SELECT COUNT(*) AS total
        FROM sites s
        WHERE s.catelog_id IN (${categorySubquery})`;
      const [sitesResult, siteCountResult] = await Promise.all([
        env.NAV_DB.prepare(sitesQuery).all(),
        env.NAV_DB.prepare(siteCountQuery).first()
      ]);
      totalSites = Number(siteCountResult?.total || 0);
      sites = (sitesResult.results || []).slice(0, siteLimit);
    }
    for (const site of sites) {
      nodes.push({
        id: `site:${site.id}`,
        title: site.name || "\u672A\u547D\u540D",
        kind: "site",
        url: site.url || "",
        logo: site.logo || ""
      });
      edges.push({ source: `cat:${site.catelog_id}`, target: `site:${site.id}` });
    }
    const body = JSON.stringify({
      code: 200,
      data: {
        nodes,
        edges,
        meta: {
          totalCategories,
          categoryTruncated: totalCategories > categories.length,
          categoryLimit: GRAPH_CATEGORY_LIMIT,
          totalSites,
          truncated: totalSites > siteLimit,
          limit: siteLimit,
          nodeLimit: GRAPH_TOTAL_NODE_LIMIT
        }
      }
    });
    if (cacheKey) {
      context.waitUntil(
        env.NAV_AUTH.put(cacheKey, body, { expirationTtl: GRAPH_CACHE_TTL }).catch((e) => {
          console.warn("Graph cache write failed:", e);
        })
      );
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Cache": "MISS"
      }
    });
  } catch (e) {
    return errorResponse(`Failed to build graph: ${e.message}`, 500);
  }
}
__name(onRequestGet8, "onRequestGet");

// api/pending/index.js
async function onRequestGet9(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  const url = new URL(request.url);
  const { page, pageSize, offset } = parsePagination(url.searchParams, { maxPageSize: 200 });
  try {
    const [{ results }, countResult] = await Promise.all([
      env.NAV_DB.prepare(`
        SELECT p.*, c.catelog
        FROM pending_sites p
        LEFT JOIN category c ON p.catelog_id = c.id
        ORDER BY p.create_time DESC
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all(),
      env.NAV_DB.prepare(`
        SELECT COUNT(*) as total FROM pending_sites
      `).first()
    ]);
    const total = countResult ? countResult.total : 0;
    return jsonResponse({
      code: 200,
      data: results,
      total,
      page,
      pageSize
    });
  } catch (e) {
    return errorResponse(`Failed to fetch pending config data: ${e.message}`, 500);
  }
}
__name(onRequestGet9, "onRequestGet");

// lib/settings-parser.js
var SETTINGS_SCHEMA = {
  layout_hide_desc: { default: false, type: "bool" },
  layout_hide_links: { default: false, type: "bool" },
  layout_hide_category: { default: false, type: "bool" },
  layout_hide_title: { default: false, type: "bool" },
  home_title_size: { default: "", type: "string" },
  home_title_color: { default: "", type: "string" },
  layout_hide_subtitle: { default: false, type: "bool" },
  home_subtitle_size: { default: "", type: "string" },
  home_subtitle_color: { default: "", type: "string" },
  home_hide_stats: { default: false, type: "bool" },
  home_stats_size: { default: "", type: "string" },
  home_stats_color: { default: "", type: "string" },
  home_hide_hitokoto: { default: false, type: "bool" },
  home_hitokoto_size: { default: "", type: "string" },
  home_hitokoto_color: { default: "", type: "string" },
  home_hide_admin: { default: false, type: "boolOrOne" },
  home_custom_font_url: { default: "", type: "string" },
  home_title_font: { default: "", type: "string" },
  home_subtitle_font: { default: "", type: "string" },
  home_stats_font: { default: "", type: "string" },
  home_hitokoto_font: { default: "", type: "string" },
  home_site_name: { default: "", type: "string" },
  home_site_description: { default: "", type: "string" },
  home_footer_text: { default: "", type: "string" },
  home_search_engine_enabled: { default: false, type: "bool" },
  home_default_category: { default: "", type: "string" },
  home_remember_last_category: { default: false, type: "bool" },
  home_category_position: { default: "below_search", type: "string" },
  home_category_flow: { default: "single_line", type: "string" },
  layout_grid_cols: { default: "4", type: "string" },
  layout_custom_wallpaper: { default: "", type: "string" },
  layout_menu_layout: { default: "horizontal", type: "string" },
  bing_country: { default: "", type: "string" },
  layout_enable_frosted_glass: { default: false, type: "bool" },
  layout_frosted_glass_intensity: { default: "15", type: "string" },
  layout_enable_bg_blur: { default: false, type: "bool" },
  layout_bg_blur_intensity: { default: "0", type: "string" },
  layout_card_style: { default: "style1", type: "string" },
  layout_card_animation: { default: "radial", type: "string" },
  layout_card_border_radius: { default: "12", type: "string" },
  mobile_layout_hide_desc: { default: true, type: "bool" },
  mobile_layout_hide_links: { default: true, type: "bool" },
  mobile_layout_hide_category: { default: false, type: "bool" },
  mobile_layout_enable_frosted_glass: { default: false, type: "bool" },
  mobile_layout_frosted_glass_intensity: { default: "15", type: "string" },
  mobile_layout_grid_cols: { default: "3", type: "string" },
  mobile_layout_card_style: { default: "style2", type: "string" },
  mobile_layout_card_animation: { default: "radial", type: "string" },
  mobile_layout_card_border_radius: { default: "12", type: "string" },
  mobile_card_title_font: { default: "", type: "string" },
  mobile_card_title_size: { default: "13", type: "string" },
  mobile_card_title_color: { default: "", type: "string" },
  mobile_card_desc_font: { default: "", type: "string" },
  mobile_card_desc_size: { default: "11", type: "string" },
  mobile_card_desc_color: { default: "", type: "string" },
  wallpaper_source: { default: "bing", type: "string" },
  wallpaper_cid_360: { default: "36", type: "string" },
  card_title_font: { default: "", type: "string" },
  card_title_size: { default: "16", type: "string" },
  card_title_color: { default: "", type: "string" },
  card_desc_font: { default: "", type: "string" },
  card_desc_size: { default: "14", type: "string" },
  card_desc_color: { default: "", type: "string" }
};
var STYLE_SIZE_KEYS = /* @__PURE__ */ new Set([
  "home_title_size",
  "home_subtitle_size",
  "home_stats_size",
  "home_hitokoto_size",
  "card_title_size",
  "card_desc_size",
  "mobile_card_title_size",
  "mobile_card_desc_size"
]);
var STYLE_COLOR_KEYS = /* @__PURE__ */ new Set([
  "home_title_color",
  "home_subtitle_color",
  "home_stats_color",
  "home_hitokoto_color",
  "card_title_color",
  "card_desc_color",
  "mobile_card_title_color",
  "mobile_card_desc_color"
]);
var FONT_KEYS = /* @__PURE__ */ new Set([
  "home_title_font",
  "home_subtitle_font",
  "home_stats_font",
  "home_hitokoto_font",
  "card_title_font",
  "card_desc_font",
  "mobile_card_title_font",
  "mobile_card_desc_font"
]);
var URL_KEYS = /* @__PURE__ */ new Set([
  "home_custom_font_url",
  "layout_custom_wallpaper"
]);
function normalizeParsedCategoryPosition(position, menuLayout) {
  if (position === "above_description") return "top";
  if (["below_search", "above_search", "left", "top"].includes(position)) return position;
  return menuLayout === "vertical" ? "left" : "below_search";
}
__name(normalizeParsedCategoryPosition, "normalizeParsedCategoryPosition");
function normalizeBoolean(value) {
  if (value === true || value === false) return String(value);
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "1") return "true";
  if (text === "false" || text === "0" || text === "") return "false";
  return null;
}
__name(normalizeBoolean, "normalizeBoolean");
function normalizeIntegerRange(value, min, max, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const num = Number(text);
  if (!Number.isInteger(num) || num < min || num > max) return null;
  return String(num);
}
__name(normalizeIntegerRange, "normalizeIntegerRange");
function isEmptyOptionalValue(text) {
  const normalized = String(text ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "undefined" || normalized === "null";
}
__name(isEmptyOptionalValue, "isEmptyOptionalValue");
function normalizeSettingValueForStorage(key, value) {
  const schema = SETTINGS_SCHEMA[key];
  if (!schema) {
    return { ok: false, message: `Unknown setting key: ${key}` };
  }
  if (schema.type === "bool" || schema.type === "boolOrOne") {
    const normalized = normalizeBoolean(value);
    if (normalized === null) {
      return { ok: false, message: `Invalid boolean value for ${key}` };
    }
    return { ok: true, value: normalized };
  }
  const text = String(value ?? "").trim();
  if (STYLE_SIZE_KEYS.has(key)) {
    if (isEmptyOptionalValue(text)) return { ok: true, value: "" };
    const safeSize = sanitizeStyleSize(text);
    if (!safeSize) {
      return { ok: false, message: `Invalid font size for ${key}` };
    }
    return { ok: true, value: safeSize };
  }
  if (STYLE_COLOR_KEYS.has(key)) {
    if (isEmptyOptionalValue(text)) return { ok: true, value: "" };
    const safeColor = sanitizeStyleColor(text);
    if (!safeColor) {
      return { ok: false, message: `Invalid color value for ${key}` };
    }
    return { ok: true, value: safeColor };
  }
  if (FONT_KEYS.has(key)) {
    if (isEmptyOptionalValue(text)) return { ok: true, value: "" };
    if (!(text in FONT_MAP)) {
      return { ok: false, message: `Invalid font for ${key}` };
    }
    return { ok: true, value: text };
  }
  if (URL_KEYS.has(key)) {
    if (isEmptyOptionalValue(text)) return { ok: true, value: "" };
    const safeUrl = sanitizeUrl(text);
    if (!safeUrl) {
      return { ok: false, message: `Invalid URL for ${key}` };
    }
    return { ok: true, value: safeUrl };
  }
  if (key === "layout_grid_cols" && !["4", "5", "6", "7"].includes(text)) {
    return { ok: false, message: "Invalid layout_grid_cols" };
  }
  if (key === "mobile_layout_grid_cols" && !["1", "2", "3"].includes(text)) {
    return { ok: false, message: "Invalid mobile_layout_grid_cols" };
  }
  if (key === "layout_menu_layout" && !["horizontal", "vertical"].includes(text)) {
    return { ok: false, message: "Invalid layout_menu_layout" };
  }
  if (key === "home_category_position" && text === "above_description") {
    return { ok: true, value: "top" };
  }
  if (key === "home_category_position" && !["below_search", "above_search", "left", "top"].includes(text)) {
    return { ok: false, message: "Invalid home_category_position" };
  }
  if (key === "home_category_flow" && !["single_line", "multi_line"].includes(text)) {
    return { ok: false, message: "Invalid home_category_flow" };
  }
  if (key === "layout_card_style" && !["style1", "style2", "style3"].includes(text)) {
    return { ok: false, message: "Invalid layout_card_style" };
  }
  if (key === "mobile_layout_card_style" && !["style1", "style2", "style3"].includes(text)) {
    return { ok: false, message: "Invalid mobile_layout_card_style" };
  }
  if (key === "layout_card_animation" && !["radial", "slideUp", "fadeIn", "slideLeft", "slideRight", "convergeIn", "flipIn", "random"].includes(text)) {
    return { ok: false, message: "Invalid layout_card_animation" };
  }
  if (key === "mobile_layout_card_animation" && !["radial", "slideUp", "fadeIn", "slideLeft", "slideRight", "convergeIn", "flipIn", "random"].includes(text)) {
    return { ok: false, message: "Invalid mobile_layout_card_animation" };
  }
  if (key === "wallpaper_source" && !["bing", "360"].includes(text)) {
    return { ok: false, message: "Invalid wallpaper_source" };
  }
  if (key === "bing_country" && !["", "spotlight"].includes(text)) {
    return { ok: false, message: "Invalid bing_country" };
  }
  if (key === "layout_frosted_glass_intensity") {
    const normalized = normalizeIntegerRange(text, 0, 50, "15");
    return normalized === null ? { ok: false, message: `Invalid ${key}` } : { ok: true, value: normalized };
  }
  if (key === "mobile_layout_frosted_glass_intensity") {
    const normalized = normalizeIntegerRange(text, 0, 50, "15");
    return normalized === null ? { ok: false, message: `Invalid ${key}` } : { ok: true, value: normalized };
  }
  if (key === "layout_bg_blur_intensity") {
    const normalized = normalizeIntegerRange(text, 0, 50, "0");
    return normalized === null ? { ok: false, message: `Invalid ${key}` } : { ok: true, value: normalized };
  }
  if (key === "layout_card_border_radius") {
    const normalized = normalizeIntegerRange(text, 0, 30, "12");
    return normalized === null ? { ok: false, message: `Invalid ${key}` } : { ok: true, value: normalized };
  }
  if (key === "mobile_layout_card_border_radius") {
    const normalized = normalizeIntegerRange(text, 0, 30, "12");
    return normalized === null ? { ok: false, message: `Invalid ${key}` } : { ok: true, value: normalized };
  }
  if (key === "wallpaper_cid_360" && text && !/^\d{1,8}$/.test(text)) {
    return { ok: false, message: "Invalid wallpaper_cid_360" };
  }
  if (text.length > 2e3) {
    return { ok: false, message: `Setting value too long for ${key}` };
  }
  return { ok: true, value: text };
}
__name(normalizeSettingValueForStorage, "normalizeSettingValueForStorage");
function getSettingsKeys() {
  return Object.keys(SETTINGS_SCHEMA);
}
__name(getSettingsKeys, "getSettingsKeys");
var TYPE_CONVERTERS = {
  bool: /* @__PURE__ */ __name((v) => v === "true", "bool"),
  boolOrOne: /* @__PURE__ */ __name((v) => v === "true" || v === "1", "boolOrOne"),
  string: /* @__PURE__ */ __name((v) => v, "string")
};
function parseSettings(dbResults) {
  const dbMap = /* @__PURE__ */ new Map();
  if (dbResults && Array.isArray(dbResults)) {
    for (const row of dbResults) {
      dbMap.set(row.key, row.value);
    }
  }
  const settings = {};
  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    const dbValue = dbMap.get(key);
    if (dbValue !== void 0) {
      settings[key] = TYPE_CONVERTERS[schema.type](dbValue);
    } else {
      settings[key] = schema.default;
    }
  }
  if (!dbMap.has("home_category_position") && settings.layout_menu_layout === "vertical") {
    settings.home_category_position = "left";
  } else {
    settings.home_category_position = normalizeParsedCategoryPosition(
      settings.home_category_position,
      settings.layout_menu_layout
    );
  }
  settings.layout_menu_layout = settings.home_category_position === "left" ? "vertical" : "horizontal";
  const mobileFallbackKeys = [
    ["mobile_layout_hide_category", "layout_hide_category"],
    ["mobile_layout_enable_frosted_glass", "layout_enable_frosted_glass"],
    ["mobile_layout_frosted_glass_intensity", "layout_frosted_glass_intensity"],
    ["mobile_layout_card_animation", "layout_card_animation"],
    ["mobile_layout_card_border_radius", "layout_card_border_radius"],
    ["mobile_card_title_font", "card_title_font"],
    ["mobile_card_title_color", "card_title_color"],
    ["mobile_card_desc_font", "card_desc_font"],
    ["mobile_card_desc_color", "card_desc_color"]
  ];
  for (const [mobileKey, desktopKey] of mobileFallbackKeys) {
    if (!dbMap.has(mobileKey)) {
      settings[mobileKey] = settings[desktopKey];
    }
  }
  settings.card_title_size = settings.card_title_size || SETTINGS_SCHEMA.card_title_size.default;
  settings.card_desc_size = settings.card_desc_size || SETTINGS_SCHEMA.card_desc_size.default;
  settings.mobile_card_title_size = settings.mobile_card_title_size || SETTINGS_SCHEMA.mobile_card_title_size.default;
  settings.mobile_card_desc_size = settings.mobile_card_desc_size || SETTINGS_SCHEMA.mobile_card_desc_size.default;
  return settings;
}
__name(parseSettings, "parseSettings");

// api/public-config.js
async function onRequestGet10({ env }) {
  const submissionEnabled = String(env.ENABLE_PUBLIC_SUBMISSION) === "true";
  const turnstileConfig = getTurnstileConfig(env);
  const aiRequestDelay = parseInt(env.AI_REQUEST_DELAY, 10);
  const validAiRequestDelay = !isNaN(aiRequestDelay) && aiRequestDelay > 0 ? aiRequestDelay : 1500;
  let layoutSettings = {};
  try {
    const keys = getSettingsKeys();
    const placeholders = keys.map(() => "?").join(",");
    const { results } = await env.NAV_DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).bind(...keys).all();
    layoutSettings = parseSettings(results);
  } catch (e) {
    layoutSettings = parseSettings([]);
  }
  return jsonResponse({
    submissionEnabled,
    turnstileSiteKey: turnstileConfig.siteKey,
    aiRequestDelay: validAiRequestDelay,
    ...layoutSettings
  });
}
__name(onRequestGet10, "onRequestGet");

// api/settings.js
var LAYOUT_SETTING_KEYS = new Set(getSettingsKeys());
var AI_SETTING_KEYS = /* @__PURE__ */ new Set(["provider", "apiKey", "baseUrl", "model"]);
var WEBDAV_SETTING_KEYS = /* @__PURE__ */ new Set(["webdav_url", "webdav_username", "webdav_password", "webdav_dir"]);
var IGNORED_SETTING_KEYS = /* @__PURE__ */ new Set(["has_api_key", "debug_api_key_info", "has_webdav_password"]);
var ALLOWED_PROVIDERS = /* @__PURE__ */ new Set(["workers-ai", "gemini", "openai"]);
var SETTINGS_READ_KEYS_JSON = JSON.stringify([
  ...LAYOUT_SETTING_KEYS,
  ...AI_SETTING_KEYS,
  ...WEBDAV_SETTING_KEYS
]);
function normalizeWebdavSettingValue(key, value) {
  const rawText = String(value ?? "");
  const text = key === "webdav_password" ? rawText : rawText.trim();
  if (key === "webdav_url") {
    if (!text) return { ok: true, value: "" };
    const safeUrl = sanitizeUrl(text);
    if (!safeUrl) return { ok: false, message: "Invalid webdav_url" };
    const parsed = new URL(safeUrl);
    if (parsed.protocol !== "https:") {
      return { ok: false, message: "webdav_url must use HTTPS" };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, message: "webdav_url must not contain credentials" };
    }
    return { ok: true, value: safeUrl };
  }
  if (key === "webdav_dir") {
    if (!validateOpaqueText(text, 200).ok) {
      return { ok: false, message: "Invalid webdav_dir" };
    }
    if (text.includes("\\")) {
      return { ok: false, message: "Invalid webdav_dir" };
    }
    if (/%(?:2f|5c)/i.test(text)) {
      return { ok: false, message: "Invalid webdav_dir" };
    }
    if (text.split("/").some((segment) => segment.trim() === "..")) {
      return { ok: false, message: "Invalid webdav_dir" };
    }
    return { ok: true, value: text };
  }
  if (key === "webdav_username") {
    if (!validateOpaqueText(text, 256).ok) {
      return { ok: false, message: "Invalid webdav_username" };
    }
    return { ok: true, value: text };
  }
  if (key === "webdav_password") {
    const normalized = validateOpaqueText(rawText, 512);
    if (!normalized.ok) {
      return { ok: false, message: "Invalid webdav_password" };
    }
    return { ok: true, value: normalized.value };
  }
  return { ok: false, message: `Unknown setting key: ${key}` };
}
__name(normalizeWebdavSettingValue, "normalizeWebdavSettingValue");
function normalizeAiSettingValue(key, value) {
  const text = String(value ?? "").trim();
  if (key === "provider") {
    return ALLOWED_PROVIDERS.has(text) ? { ok: true, value: text } : { ok: false, message: "Invalid provider" };
  }
  if (key === "baseUrl") {
    if (!text) return { ok: true, value: "" };
    const safeUrl = sanitizeUrl(text);
    return safeUrl ? { ok: true, value: safeUrl.replace(/\/+$/, "") } : { ok: false, message: "Invalid baseUrl" };
  }
  if (key === "model") {
    if (!validateOpaqueText(text, 200).ok) {
      return { ok: false, message: "Invalid model" };
    }
    return { ok: true, value: text };
  }
  if (key === "apiKey") {
    if (!validateOpaqueText(text, 4096).ok) {
      return { ok: false, message: "Invalid apiKey" };
    }
    return { ok: true, value: text };
  }
  return { ok: false, message: `Unknown setting key: ${key}` };
}
__name(normalizeAiSettingValue, "normalizeAiSettingValue");
async function onRequestGet11(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const { results } = await env.NAV_DB.prepare("SELECT key, value FROM settings WHERE key IN (SELECT value FROM json_each(?))").bind(SETTINGS_READ_KEYS_JSON).all();
    const settings = {};
    if (results) {
      results.forEach((row) => {
        if (!LAYOUT_SETTING_KEYS.has(row.key) && !AI_SETTING_KEYS.has(row.key) && !WEBDAV_SETTING_KEYS.has(row.key)) {
          return;
        }
        if (row.key === "apiKey" || row.key === "webdav_password") {
          if (row.value && row.value.length > 0) {
            settings[row.key === "apiKey" ? "has_api_key" : "has_webdav_password"] = true;
          } else {
            settings[row.key === "apiKey" ? "has_api_key" : "has_webdav_password"] = false;
          }
        } else {
          settings[row.key] = row.value;
        }
      });
    }
    return jsonResponse({
      code: 200,
      data: settings
    });
  } catch (e) {
    if (e.message && e.message.includes("no such table")) {
      return jsonResponse({
        code: 200,
        data: {}
        // No settings yet
      });
    }
    return errorResponse(`Failed to fetch settings: ${e.message}`, 500);
  }
}
__name(onRequestGet11, "onRequestGet");
async function onRequestPost11(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const body = await request.json();
    const settings = body;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return errorResponse("Invalid settings data", 400);
    }
    const normalizedEntries = [];
    for (const [key, value] of Object.entries(settings)) {
      if (IGNORED_SETTING_KEYS.has(key)) continue;
      if (key === "apiKey" || key === "webdav_password") {
        if (value === null) {
          normalizedEntries.push([key, ""]);
          continue;
        }
        if (String(value ?? "") === "") {
          continue;
        }
      }
      let normalized;
      if (LAYOUT_SETTING_KEYS.has(key)) {
        normalized = normalizeSettingValueForStorage(key, value);
      } else if (AI_SETTING_KEYS.has(key)) {
        normalized = normalizeAiSettingValue(key, value);
      } else if (WEBDAV_SETTING_KEYS.has(key)) {
        normalized = normalizeWebdavSettingValue(key, value);
      } else {
        return errorResponse(`Invalid setting key: ${key}`, 400);
      }
      if (!normalized.ok) {
        return errorResponse(normalized.message, 400);
      }
      normalizedEntries.push([key, normalized.value]);
    }
    let changedEntries = normalizedEntries;
    if (normalizedEntries.length > 0) {
      const keys = normalizedEntries.map(([key]) => key);
      const placeholders = keys.map(() => "?").join(",");
      const { results = [] } = await env.NAV_DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).bind(...keys).all();
      const existingSettings = new Map(results.map((row) => [row.key, row.value]));
      changedEntries = normalizedEntries.filter(([key, value]) => existingSettings.get(key) !== value);
    }
    if (changedEntries.length > 0) {
      const stmt = env.NAV_DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      await env.NAV_DB.batch(changedEntries.map(([key, value]) => stmt.bind(key, value)));
    }
    const touchesRenderedSettings = normalizedEntries.some(
      ([key]) => !WEBDAV_SETTING_KEYS.has(key) && !AI_SETTING_KEYS.has(key)
    );
    if (touchesRenderedSettings) {
      try {
        await Promise.all([
          env.NAV_AUTH.delete("settings_cache"),
          markHomeCacheDirty(env, "all")
        ]);
      } catch (e) {
        console.warn("Failed to clear caches:", e);
      }
    }
    return jsonResponse({
      code: 200,
      message: "Settings saved"
    });
  } catch (e) {
    return errorResponse(`Failed to save settings: ${e.message}`, 500);
  }
}
__name(onRequestPost11, "onRequestPost");

// api/update-description.js
async function onRequestPost12(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const { id, description, url, logo } = await request.json();
    if (!id || typeof description !== "string") {
      return errorResponse("Bookmark ID and description are required", 400);
    }
    const descResult = normalizeBookmarkDesc(description);
    if (!descResult.ok) return errorResponse(descResult.message, 400);
    const urlResult = normalizeOptionalBookmarkUrl(url);
    if (!urlResult.ok) return errorResponse(urlResult.message, 400);
    const logoResult = normalizeBookmarkLogo(logo, { nullIfEmpty: true });
    if (!logoResult.ok) return errorResponse(logoResult.message, 400);
    const site = await env.NAV_DB.prepare(
      "SELECT id, is_private FROM sites WHERE id = ?"
    ).bind(id).first();
    if (!site) {
      return errorResponse("Bookmark not found", 404);
    }
    const iconAPI = env.ICON_API || "https://faviconsnap.com/api/favicon?url=";
    const sanitizedLogo = buildFaviconUrl(urlResult.value, logoResult.value, iconAPI);
    const result = await env.NAV_DB.prepare(
      "UPDATE sites SET desc = ?, logo = ?, update_time = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(descResult.value, sanitizedLogo, id).run();
    if (result.changes === 0) {
      return errorResponse("Bookmark not found or no changes made", 404);
    }
    await markHomeCacheDirty(env, site.is_private ? "private" : "all");
    return jsonResponse({
      code: 200,
      message: "Description updated successfully"
    });
  } catch (e) {
    console.error("Error updating description:", e);
    return errorResponse(`Failed to update description: ${e.message}`, 500);
  }
}
__name(onRequestPost12, "onRequestPost");

// api/wallpaper.js
var API_360_BASE = "http://cdn.apc.360.cn/index.php";
var FETCH_TIMEOUT_MS = 8e3;
function fetchWithTimeout(url) {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}
__name(fetchWithTimeout, "fetchWithTimeout");
async function onRequestGet12(context) {
  const { request } = context;
  const url = new URL(request.url);
  const source = url.searchParams.get("source") || "bing";
  const action = url.searchParams.get("action") || "";
  const cid = url.searchParams.get("cid") || "36";
  const country = url.searchParams.get("country") || "";
  const indexStr = url.searchParams.get("index") || "-1";
  let currentIndex = parseInt(indexStr);
  if (isNaN(currentIndex)) currentIndex = -1;
  try {
    if (source === "360" && action === "categories") {
      const apiUrl = `${API_360_BASE}?c=WallPaper&a=getAllCategoriesV2&from=360chrome`;
      const res = await fetchWithTimeout(apiUrl);
      if (!res.ok) return errorResponse("Failed to fetch 360 categories", 502);
      const json = await res.json();
      return jsonResponse({ code: 200, data: json });
    }
    if (source === "360" && action === "list") {
      const start = url.searchParams.get("start") || "0";
      const count = url.searchParams.get("count") || "8";
      const apiUrl = `${API_360_BASE}?c=WallPaper&a=getAppsByCategory&from=360chrome&cid=${cid}&start=${start}&count=${count}`;
      const res = await fetchWithTimeout(apiUrl);
      if (!res.ok) return errorResponse("Failed to fetch 360 wallpapers", 502);
      const json = await res.json();
      return jsonResponse({ code: 200, data: json });
    }
    let targetUrl = "";
    let nextIndex = 0;
    if (source === "360") {
      const apiUrl = `${API_360_BASE}?c=WallPaper&a=getAppsByCategory&from=360chrome&cid=${cid}&start=0&count=8`;
      const res = await fetchWithTimeout(apiUrl);
      if (res.ok) {
        const json = await res.json();
        if (json.errno === "0" && json.data && json.data.length > 0) {
          nextIndex = (currentIndex + 1) % json.data.length;
          const targetItem = json.data[nextIndex];
          if (targetItem.url) {
            targetUrl = targetItem.url.replace("http://", "https://");
          }
        }
      }
    } else {
      let bingUrl = "";
      if (country === "spotlight") {
        bingUrl = "https://peapix.com/spotlight/feed?n=7";
      } else {
        bingUrl = `https://peapix.com/bing/feed?n=7&country=${encodeURIComponent(country)}`;
      }
      const res = await fetchWithTimeout(bingUrl);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          nextIndex = (currentIndex + 1) % data.length;
          const targetItem = data[nextIndex];
          targetUrl = targetItem.fullUrl || targetItem.url;
        }
      }
    }
    if (targetUrl) {
      return jsonResponse({ code: 200, data: { url: targetUrl, index: nextIndex } });
    } else {
      return errorResponse("Failed to fetch wallpaper", 500);
    }
  } catch (e) {
    return errorResponse(`Error: ${e.message}`, 500);
  }
}
__name(onRequestGet12, "onRequestGet");

// admin/logout.js
async function onRequest2(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const token = getSessionToken(request);
  if (token) {
    await env.NAV_AUTH.delete(`session_${token}`);
    await env.NAV_AUTH.delete(`csrf_${token}`);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/admin",
      "Set-Cookie": buildSessionCookie("", { maxAge: 0 })
    }
  });
}
__name(onRequest2, "onRequest");

// api/[[path]].js
async function onRequest3(context) {
  const { request } = context;
  const method = request.method.toUpperCase();
  if (method === "HEAD") {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "GET, POST, PUT, PATCH, DELETE",
        "Cache-Control": "no-store"
      }
    });
  }
  return errorResponse("Not Found", 404);
}
__name(onRequest3, "onRequest");

// admin/index.js
async function onRequestGet13(context) {
  const { request, env } = context;
  if (!await isAdminAuthenticated(request, env)) {
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/admin/login"
      }
    });
  }
  const sessionToken = getSessionToken(request);
  try {
    const url = new URL(request.url);
    url.pathname = "/admin/index.html";
    const response = await env.ASSETS.fetch(url);
    if (response.ok) {
      const csrfToken = await env.NAV_AUTH.get(`csrf_${sessionToken}`);
      if (csrfToken) {
        let html = await response.text();
        html = html.replace("</head>", `<meta name="csrf-token" content="${csrfToken}">
</head>`);
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        headers.delete("Content-Length");
        headers.delete("ETag");
        headers.delete("Content-Encoding");
        headers.delete("Access-Control-Allow-Origin");
        return new Response(html, { headers });
      }
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `/admin/login?error=${encodeURIComponent("\u767B\u5F55\u72B6\u6001\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55")}`,
          "Set-Cookie": buildSessionCookie("", { maxAge: 0 }),
          "Cache-Control": "no-store"
        }
      });
    } else {
      console.error("Failed to load admin HTML:", response.status);
      return new Response("\u7BA1\u7406\u9875\u9762\u52A0\u8F7D\u5931\u8D25", { status: 500 });
    }
  } catch (e) {
    console.error("Error loading admin page:", e);
    return new Response("\u7BA1\u7406\u9875\u9762\u52A0\u8F7D\u5931\u8D25: " + e.message, { status: 500 });
  }
}
__name(onRequestGet13, "onRequestGet");

// lib/menu-renderer.js
function renderHorizontalMenu(cats, currentCatalogName) {
  if (!cats || cats.length === 0) return "";
  return _renderHorizontalItems(cats, currentCatalogName, 0);
}
__name(renderHorizontalMenu, "renderHorizontalMenu");
function _renderHorizontalItems(cats, currentCatalogName, level) {
  return cats.map((cat) => {
    const isActive = currentCatalogName === cat.catelog;
    const hasChildren = cat.children && cat.children.length > 0;
    const safeName = escapeHTML(cat.catelog);
    const catalogParam = encodeURIComponent(String(cat.id));
    const linkUrl = `?catalog=${catalogParam}`;
    const isRoot = level === 0;
    const activeClass = isActive ? "active" : isRoot ? "inactive" : "";
    const navItemActiveClass = isActive ? "nav-item-active" : "";
    const wrapperClass = isRoot ? "menu-item-wrapper relative inline-block text-left" : "menu-item-wrapper relative block w-full";
    const linkClass = isRoot ? `nav-btn ${activeClass} ${navItemActiveClass}` : `dropdown-item ${activeClass} ${navItemActiveClass}`;
    const arrowSvg = hasChildren ? isRoot ? '<svg class="w-3 h-3 ml-1 opacity-70"><use href="#icon-chevron-down"/></svg>' : '<svg class="dropdown-arrow-icon"><use href="#icon-chevron-right"/></svg>' : "";
    const childrenHtml = hasChildren ? `<div class="dropdown-menu">${_renderHorizontalItems(cat.children, currentCatalogName, level + 1)}</div>` : "";
    return `<div class="${wrapperClass}"><a href="${linkUrl}" class="${linkClass}" data-id="${cat.id}">${safeName}${arrowSvg}</a>${childrenHtml}</div>`;
  }).join("");
}
__name(_renderHorizontalItems, "_renderHorizontalItems");
function renderVerticalMenu(cats, currentCatalogName, isCustomWallpaper) {
  return _renderVerticalItems(cats, currentCatalogName, isCustomWallpaper, 0);
}
__name(renderVerticalMenu, "renderVerticalMenu");
function _renderVerticalItems(cats, currentCatalogName, isCustomWallpaper, level) {
  return cats.map((cat) => {
    const safeName = escapeHTML(cat.catelog);
    const catalogParam = encodeURIComponent(String(cat.id));
    const isActive = currentCatalogName === cat.catelog;
    const baseClass = "flex items-center px-3 py-2 rounded-lg w-full transition-colors duration-200";
    const activeClass = isActive ? "bg-secondary-100 text-primary-700 dark:bg-gray-800 dark:text-primary-400" : "hover:bg-gray-100 text-gray-700 dark:text-gray-300 dark:hover:bg-gray-800";
    const defaultIconColor = isCustomWallpaper ? "text-gray-600" : "text-gray-400 dark:text-gray-500";
    const iconClass = isActive ? "text-primary-600 dark:text-primary-400" : defaultIconColor;
    const indent = level * 12;
    let html = `
      <a href="?catalog=${catalogParam}" data-id="${cat.id}" class="${baseClass} ${activeClass}" style="padding-left: ${12 + indent}px">
          <svg class="h-5 w-5 mr-2 ${iconClass}"><use href="#icon-folder"/></svg>
          ${safeName}
      </a>`;
    if (cat.children && cat.children.length > 0) {
      html += _renderVerticalItems(cat.children, currentCatalogName, isCustomWallpaper, level + 1);
    }
    return html;
  }).join("");
}
__name(_renderVerticalItems, "_renderVerticalItems");

// lib/card-model.js
function getDeviceSetting(settings, device, key, fallback = "") {
  const mobileKey = `mobile_${key}`;
  if (device === "mobile" && settings[mobileKey] !== void 0) {
    return settings[mobileKey];
  }
  return settings[key] ?? fallback;
}
__name(getDeviceSetting, "getDeviceSetting");
function getDeviceSettingOrDefault(settings, device, key, fallback = "") {
  const value = getDeviceSetting(settings, device, key, fallback);
  return String(value ?? "").trim() === "" ? fallback : value;
}
__name(getDeviceSettingOrDefault, "getDeviceSettingOrDefault");
function buildCardTemplateConfig(settings = {}, device = "desktop") {
  const isMobile = device === "mobile";
  const cardStyle = getDeviceSetting(settings, device, "layout_card_style", isMobile ? "style2" : "style1") || (isMobile ? "style2" : "style1");
  const isNavigationTileStyle = cardStyle === "style3";
  const hideDesc = isNavigationTileStyle || getDeviceSetting(settings, device, "layout_hide_desc", isMobile) === true;
  const hideLinks = isNavigationTileStyle || getDeviceSetting(settings, device, "layout_hide_links", isMobile) === true;
  const hideCategory = isNavigationTileStyle || getDeviceSetting(settings, device, "layout_hide_category", false) === true;
  const enableFrostedGlass = getDeviceSetting(settings, device, "layout_enable_frosted_glass", false) === true;
  const cardAnimation = getDeviceSetting(settings, device, "layout_card_animation", "radial") || "radial";
  const gridCols = getDeviceSetting(settings, device, "layout_grid_cols", isMobile ? "3" : "4") || (isMobile ? "3" : "4");
  const hideCopyText = isMobile ? Number(gridCols) >= 3 : (Number(gridCols) || 4) >= 5;
  const titleSize = getDeviceSetting(settings, device, "card_title_size", isMobile ? "13" : "16") || (isMobile ? "13" : "16");
  const titleColor = getDeviceSetting(settings, device, "card_title_color", "");
  const titleFont = getDeviceSetting(settings, device, "card_title_font", "");
  const descSize = getDeviceSetting(settings, device, "card_desc_size", isMobile ? "11" : "14") || (isMobile ? "11" : "14");
  const descColor = getDeviceSetting(settings, device, "card_desc_color", "");
  const descFont = getDeviceSetting(settings, device, "card_desc_font", "");
  const cardRadius = getDeviceSettingOrDefault(settings, device, "layout_card_border_radius", "12");
  const frostedGlassIntensity = getDeviceSettingOrDefault(settings, device, "layout_frosted_glass_intensity", "15");
  return {
    device,
    hideDesc,
    hideLinks,
    hideCategory,
    enableFrostedGlass,
    cardStyle,
    cardAnimation,
    gridCols,
    hideCopyText,
    titleSize,
    titleColor,
    titleFont,
    descSize,
    descColor,
    descFont,
    cardRadius,
    frostedGlassIntensity,
    aboveFoldImageCount: 8,
    baseCardClass: enableFrostedGlass ? "site-card group h-full flex flex-col overflow-hidden transition-all" : "site-card group h-full flex flex-col bg-white border border-primary-100/60 shadow-sm overflow-hidden dark:bg-gray-800 dark:border-gray-700",
    frostedClass: enableFrostedGlass ? "frosted-glass-effect" : "",
    cardStyleClass: cardStyle === "style2" ? "style-2" : isNavigationTileStyle ? "style-3" : "",
    titleClass: "site-title text-base font-medium text-gray-900 dark:text-gray-100 truncate transition-all duration-300 origin-left",
    descClass: "mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2",
    categoryClass: "site-category inline-flex items-center px-2 py-0.5 mt-1 rounded-full text-xs font-medium bg-secondary-100 text-primary-700 dark:bg-secondary-800 dark:text-primary-300",
    linkRowClass: "mt-3 flex items-center justify-between",
    urlTextClass: "text-xs text-primary-600 dark:text-primary-400 truncate flex-1 min-w-0 mr-2",
    copyButtonBaseClass: "copy-btn relative flex items-center px-2 py-1 rounded-full text-xs font-medium transition-colors",
    copyButtonEnabledClass: "bg-accent-100 text-accent-700 hover:bg-accent-200 dark:bg-accent-900/30 dark:text-accent-300 dark:hover:bg-accent-900/50",
    copyButtonDisabledClass: "bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500",
    logoClass: "w-10 h-10 rounded-lg object-cover bg-gray-100 dark:bg-gray-700",
    siteIconClass: "site-icon flex-shrink-0 mr-4 transition-all duration-300"
  };
}
__name(buildCardTemplateConfig, "buildCardTemplateConfig");
function buildCardViewModel(site) {
  const rawName = site?.name || "\u672A\u547D\u540D";
  const normalizedUrl = sanitizeUrl(site?.url);
  const normalizedLogo = sanitizeUrl(site?.logo);
  const rawCatalog = site?.catelog_name || site?.catelog || "\u672A\u5206\u7C7B";
  const rawDesc = site?.desc || "\u6682\u65E0\u63CF\u8FF0";
  return {
    id: site?.id,
    catelog_id: site?.catelog_id,
    nameHtml: escapeHTML(rawName),
    catalogHtml: escapeHTML(rawCatalog),
    descHtml: escapeHTML(rawDesc),
    urlHtml: escapeHTML(normalizedUrl),
    displayUrlHtml: escapeHTML(normalizedUrl || "\u672A\u63D0\u4F9B\u94FE\u63A5"),
    logoUrlHtml: escapeHTML(normalizedLogo),
    cardInitialHtml: escapeHTML((rawName.trim().charAt(0) || "\u7AD9").toUpperCase()),
    hasValidUrl: Boolean(normalizedUrl),
    hasDesc: Boolean(site?.desc)
  };
}
__name(buildCardViewModel, "buildCardViewModel");
function buildCardHydrationState(sites, settings = {}) {
  return {
    configs: {
      desktop: buildCardTemplateConfig(settings, "desktop"),
      mobile: buildCardTemplateConfig(settings, "mobile")
    },
    cards: (sites || []).map((site) => buildCardViewModel(site))
  };
}
__name(buildCardHydrationState, "buildCardHydrationState");

// lib/card-renderer.js
function renderSiteCards(sites, settings) {
  const config = buildCardTemplateConfig(settings);
  const processed = sites.map((site) => buildCardViewModel(site));
  return processed.map((card, index) => {
    const isAboveFold = index < config.aboveFoldImageCount;
    const imgLoadingAttrs = isAboveFold ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';
    const descHtml = config.hideDesc ? "" : `<p class="${config.descClass}" title="${card.descHtml}">${card.descHtml}</p>`;
    const linksHtml = config.hideLinks ? "" : `
      <div class="${config.linkRowClass}">
        <span class="${config.urlTextClass}" title="${card.displayUrlHtml}">${card.displayUrlHtml}</span>
        <button class="${config.copyButtonBaseClass} ${card.hasValidUrl ? config.copyButtonEnabledClass : config.copyButtonDisabledClass}" data-url="${card.urlHtml}" ${card.hasValidUrl ? "" : "disabled"}>
          <svg class="h-3 w-3 ${config.hideCopyText ? "" : "mr-1"}"><use href="#icon-copy"/></svg>
          ${config.hideCopyText ? "" : '<span class="copy-text">\u590D\u5236</span>'}
          <span class="copy-success hidden absolute -top-8 right-0 bg-accent-500 text-white text-xs px-2 py-1 rounded shadow-md">\u5DF2\u590D\u5236!</span>
        </button>
      </div>`;
    const categoryHtml = config.hideCategory ? "" : `
      <span class="${config.categoryClass}">
        ${card.catalogHtml}
      </span>`;
    return `
      <div class="${config.baseCardClass} ${config.frostedClass} ${config.cardStyleClass} card-anim-enter" data-id="${card.id}">
        <div class="site-card-content">
          <a href="${card.urlHtml || "#"}" ${card.hasValidUrl ? 'target="_blank" rel="noopener noreferrer"' : ""} class="block">
            <div class="flex items-start">
              <div class="${config.siteIconClass}">
                ${card.logoUrlHtml ? `<img src="${card.logoUrlHtml}" alt="${card.nameHtml}" width="40" height="40" class="${config.logoClass}" ${imgLoadingAttrs}>` : `<div class="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white font-semibold text-lg shadow-inner">${card.cardInitialHtml}</div>`}
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="${config.titleClass}" title="${card.nameHtml}">${card.nameHtml}</h3>
                ${categoryHtml}
              </div>
            </div>
            ${descHtml}
          </a>
          ${linksHtml}
        </div>
      </div>`;
  }).join("");
}
__name(renderSiteCards, "renderSiteCards");
function renderEmptyState(categoryCount, hideAdmin) {
  const emptyStateText = categoryCount === 0 ? "\u6B22\u8FCE\u4F7F\u7528 iori-nav" : "\u6682\u65E0\u4E66\u7B7E";
  const emptyStateSub = categoryCount === 0 ? "\u9879\u76EE\u521D\u59CB\u5316\u5B8C\u6210\uFF0C\u8BF7\u524D\u5F80\u540E\u53F0\u6DFB\u52A0\u5206\u7C7B\u548C\u4E66\u7B7E\u3002" : "\u8BE5\u5206\u7C7B\u4E0B\u8FD8\u6CA1\u6709\u6DFB\u52A0\u4EFB\u4F55\u4E66\u7B7E\u3002";
  return `
    <div class="col-span-full flex flex-col items-center justify-center py-10 sm:py-12 text-center animate-fade-in">
        <div class="w-14 h-14 sm:w-16 sm:h-16 mb-3 text-gray-200 dark:text-gray-700/50">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.25" class="w-full h-full">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
        </div>
        <h3 class="text-lg font-medium text-gray-600 dark:text-gray-300 mb-1">${emptyStateText}</h3>
        <p class="text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto mb-5">${emptyStateSub}</p>
        ${!hideAdmin ? `<a href="/admin" target="_blank" class="inline-flex items-center px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-all shadow-lg shadow-primary-600/20 hover:shadow-primary-600/40 hover:-translate-y-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            \u524D\u5F80\u7BA1\u7406\u540E\u53F0
        </a>` : ""}
    </div>`;
}
__name(renderEmptyState, "renderEmptyState");

// lib/wallpaper-defaults.js
var STYLE_DEFAULT_WALLPAPERS = {
  style1: "https://img.peapix.com/dc6e559cacb14f9c83b46d5a7f189bab_1920.jpg",
  style2: "https://img.peapix.com/1f4688b7a0d64bda9c508f9498b04f49_1920.jpg",
  style3: "https://main.ssss.nyc.mn/background.webp"
};
function getStyleDefaultWallpaper(cardStyle = "style1") {
  return STYLE_DEFAULT_WALLPAPERS[cardStyle] || STYLE_DEFAULT_WALLPAPERS.style1;
}
__name(getStyleDefaultWallpaper, "getStyleDefaultWallpaper");
function resolveWallpaperUrl(customWallpaper = "", cardStyle = "style1") {
  const custom = String(customWallpaper || "").trim();
  return custom || getStyleDefaultWallpaper(cardStyle);
}
__name(resolveWallpaperUrl, "resolveWallpaperUrl");

// index.js
var cachedTemplateHtml = null;
async function getTemplateHtml(env, requestUrl) {
  if (cachedTemplateHtml !== null) return cachedTemplateHtml;
  const res = await env.ASSETS.fetch(new URL("/index.html", requestUrl));
  cachedTemplateHtml = await res.text();
  return cachedTemplateHtml;
}
__name(getTemplateHtml, "getTemplateHtml");
function getThemeClasses(isCustomWallpaper) {
  return isCustomWallpaper ? {
    headerClass: "bg-transparent border-none shadow-none transition-colors duration-300",
    containerClass: "rounded-2xl",
    titleColorClass: "text-gray-900 dark:text-gray-100",
    subTextColorClass: "text-gray-600 dark:text-gray-300",
    searchInputClass: "bg-white/90 backdrop-blur border border-gray-200 text-gray-800 placeholder-gray-400 focus:ring-primary-200 focus:border-primary-400 focus:bg-white dark:bg-gray-800/90 dark:border-gray-600 dark:text-gray-200 dark:focus:bg-gray-800",
    searchIconClass: "text-gray-400 dark:text-gray-500"
  } : {
    headerClass: "bg-primary-700 text-white border-b border-primary-600 shadow-sm dark:bg-gray-900 dark:border-gray-800",
    containerClass: "rounded-2xl border border-primary-100/60 bg-white/80 backdrop-blur-sm shadow-sm dark:bg-gray-800/80 dark:border-gray-700",
    titleColorClass: "text-white",
    subTextColorClass: "text-primary-100/90 dark:text-gray-400",
    searchInputClass: "bg-white/15 text-white placeholder-primary-200 focus:ring-white/30 focus:bg-white/20 border-none dark:bg-gray-800/50 dark:text-gray-200 dark:placeholder-gray-500",
    searchIconClass: "text-primary-200 dark:text-gray-500"
  };
}
__name(getThemeClasses, "getThemeClasses");
function normalizeCssPixelValue(value, fallback) {
  const normalized = String(value ?? "").trim().replace(/[^0-9]/g, "");
  if (normalized === "") return String(fallback);
  return normalized;
}
__name(normalizeCssPixelValue, "normalizeCssPixelValue");
async function onRequest4(context) {
  const { request, env } = context;
  const isAuthenticated = await isAdminAuthenticated(request, env);
  const includePrivate = isAuthenticated ? 1 : 0;
  const url = new URL(request.url);
  const isHomePage = url.pathname === "/" && !url.search;
  const cacheScope = isAuthenticated ? "private" : "public";
  const cookies = request.headers.get("Cookie") || "";
  const hasLegacyStaleCookie = cookies.includes("iori_cache_stale=1");
  const hasPublicStaleCookie = hasLegacyStaleCookie || cookies.includes("iori_cache_public_stale=1");
  const hasPrivateStaleCookie = hasLegacyStaleCookie || cookies.includes("iori_cache_private_stale=1");
  let shouldClearCookie = false;
  let cacheDirty = false;
  let cacheDirtyValue = null;
  let cacheGeneration = null;
  if (isHomePage) {
    if (isAuthenticated && (hasPublicStaleCookie || hasPrivateStaleCookie)) {
      if (hasPublicStaleCookie && hasPrivateStaleCookie) {
        await markHomeCacheDirty(env, "all");
      } else if (hasPublicStaleCookie) {
        await markHomeCacheDirty(env, "public");
      } else {
        await markHomeCacheDirty(env, "private");
      }
      shouldClearCookie = true;
    }
    let cachedHtml = null;
    try {
      [cacheDirtyValue, cacheGeneration] = await Promise.all([
        getHomeCacheDirtyValue(env, cacheScope),
        ensureSchemaReady(env).then(() => getGraphCacheGeneration(env))
      ]);
      if (cacheGeneration !== null) {
        cachedHtml = await env.NAV_AUTH.get(getHomeCacheKey(cacheScope, cacheGeneration));
      }
    } catch (e) {
      console.warn("Failed to read home cache:", e);
      cachedHtml = null;
      cacheDirtyValue = null;
      cacheGeneration = null;
    }
    cacheDirty = !!cacheDirtyValue;
    if (!cacheDirty && cachedHtml) {
      const response2 = new Response(cachedHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": isAuthenticated ? "private, no-store, max-age=0" : "public, max-age=0, must-revalidate",
          "X-Cache": "HIT"
        }
      });
      if (shouldClearCookie) {
        response2.headers.append("Set-Cookie", "iori_cache_stale=; Path=/; Max-Age=0; SameSite=Lax");
        response2.headers.append("Set-Cookie", "iori_cache_public_stale=; Path=/; Max-Age=0; SameSite=Lax");
        response2.headers.append("Set-Cookie", "iori_cache_private_stale=; Path=/; Max-Age=0; SameSite=Lax");
      }
      return response2;
    }
  }
  const categoryQuery = isAuthenticated ? "SELECT id, catelog, sort_order, parent_id, is_private FROM category ORDER BY sort_order ASC, id ASC" : "SELECT id, catelog, sort_order, parent_id FROM category WHERE is_private = 0 ORDER BY sort_order ASC, id ASC";
  const settingsKeys = getSettingsKeys();
  const settingsPlaceholders = settingsKeys.map(() => "?").join(",");
  const sitesQuery = `SELECT id, name, url, logo, desc, catelog_id, catelog_name
                      FROM sites WHERE (is_private = 0 OR ? = 1) ORDER BY sort_order ASC, create_time DESC`;
  const settingsCacheKey = "settings_cache";
  const fetchSettings = /* @__PURE__ */ __name(async () => {
    try {
      const cached = await env.NAV_AUTH.get(settingsCacheKey, { type: "json" });
      if (cached) return { results: cached, fromCache: true };
    } catch (e) {
      console.warn("Settings cache read failed:", e);
    }
    const result = await env.NAV_DB.prepare(`SELECT key, value FROM settings WHERE key IN (${settingsPlaceholders})`).bind(...settingsKeys).all();
    if (result.results && env.NAV_AUTH) {
      context.waitUntil(env.NAV_AUTH.put(settingsCacheKey, JSON.stringify(result.results), { expirationTtl: 86400 }));
    }
    return result;
  }, "fetchSettings");
  const [categoriesResult, settingsResult, sitesResult, templateHtml] = await Promise.all([
    env.NAV_DB.prepare(categoryQuery).all().catch((e) => ({ results: [], error: e })),
    fetchSettings().catch((e) => ({ results: [], error: e })),
    env.NAV_DB.prepare(sitesQuery).bind(includePrivate).all().catch((e) => ({ results: [], error: e })),
    getTemplateHtml(env, request.url)
  ]);
  let categories = categoriesResult.results || [];
  if (categoriesResult.error) console.error("Failed to fetch categories:", categoriesResult.error);
  const categoryMap = /* @__PURE__ */ new Map();
  const categoryIdMap = /* @__PURE__ */ new Map();
  const rootCategories = [];
  categories.forEach((cat) => {
    cat.children = [];
    cat.sort_order = normalizeSortOrder(cat.sort_order);
    categoryMap.set(cat.id, cat);
    if (cat.catelog) categoryIdMap.set(cat.catelog, cat.id);
  });
  categories.forEach((cat) => {
    if (cat.parent_id && categoryMap.has(cat.parent_id)) {
      categoryMap.get(cat.parent_id).children.push(cat);
    } else {
      rootCategories.push(cat);
    }
  });
  const sortCats = /* @__PURE__ */ __name((cats) => {
    cats.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    cats.forEach((c) => sortCats(c.children));
  }, "sortCats");
  sortCats(rootCategories);
  const S = parseSettings(settingsResult.results || settingsResult);
  let allSites = sitesResult.results || [];
  if (sitesResult.error) return new Response(`Failed to fetch sites: ${sitesResult.error.message}`, { status: 500 });
  function resolveCatalogId(catalogValue, options = {}) {
    const value = String(catalogValue || "").trim();
    if (!value || value.toLowerCase() === "all") return null;
    if (/^\d+$/.test(value)) {
      const id = Number(value);
      if (categoryMap.has(id)) return id;
    }
    return options.allowName && categoryIdMap.has(value) ? categoryIdMap.get(value) : null;
  }
  __name(resolveCatalogId, "resolveCatalogId");
  const requestedCatalogValue = (url.searchParams.get("catalog") || "").trim();
  let requestedCatalogId = resolveCatalogId(requestedCatalogValue);
  if (!requestedCatalogValue) {
    const defaultCat = (S.home_default_category || "").trim();
    requestedCatalogId = resolveCatalogId(defaultCat, { allowName: true });
  }
  let targetCategoryIds = [];
  let currentCatalogName = "";
  const catalogExists = requestedCatalogId !== null;
  if (catalogExists) {
    const requestedCategory = categoryMap.get(requestedCatalogId);
    currentCatalogName = requestedCategory.catelog;
    targetCategoryIds.push(requestedCatalogId);
  }
  const sites = targetCategoryIds.length > 0 ? allSites.filter((site) => targetCategoryIds.includes(site.catelog_id)) : allSites;
  const resolvedWallpaperUrl = resolveWallpaperUrl(S.layout_custom_wallpaper, S.layout_card_style);
  const isCustomWallpaper = Boolean(resolvedWallpaperUrl);
  const themeClass = isCustomWallpaper ? "custom-wallpaper" : "";
  const themeClasses = getThemeClasses(isCustomWallpaper);
  const { headerClass, containerClass, titleColorClass, subTextColorClass, searchInputClass, searchIconClass } = themeClasses;
  const allLinkActive = !catalogExists;
  const allLinkClass = allLinkActive ? "active" : "inactive";
  const allLinkActiveMarker = allLinkActive ? "nav-item-active" : "";
  const horizontalAllLink = `
    <div class="menu-item-wrapper relative inline-block text-left">
      <a href="?catalog=all" class="nav-btn ${allLinkClass} ${allLinkActiveMarker}">\u5168\u90E8</a>
    </div>`;
  const horizontalCatalogMarkup = horizontalAllLink + renderHorizontalMenu(rootCategories, currentCatalogName);
  const catalogLinkMarkup = renderVerticalMenu(rootCategories, currentCatalogName, isCustomWallpaper);
  let sitesGridMarkup = sites.length > 0 ? renderSiteCards(sites, S) : renderEmptyState(categories.length, S.home_hide_admin);
  const getMobileGridClass = /* @__PURE__ */ __name((cols) => {
    if (cols === "1") return "grid-cols-1";
    if (cols === "3") return "grid-cols-3";
    return "grid-cols-2";
  }, "getMobileGridClass");
  const getDesktopGridClass = /* @__PURE__ */ __name((cols) => {
    if (cols === "5") return "md:grid-cols-3 lg:grid-cols-5";
    if (cols === "6") return "md:grid-cols-3 lg:grid-cols-5 min-[1200px]:grid-cols-6";
    if (cols === "7") return "md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7";
    return "md:grid-cols-3 lg:grid-cols-4";
  }, "getDesktopGridClass");
  const getCardStyleGridClass = /* @__PURE__ */ __name((style, prefix) => {
    if (style === "style3") return `${prefix}-card-style3`;
    return style === "style2" ? `${prefix}-card-style2` : `${prefix}-card-style1`;
  }, "getCardStyleGridClass");
  const mobileCardStyleClass = getCardStyleGridClass(S.mobile_layout_card_style, "mobile");
  const desktopCardStyleClass = getCardStyleGridClass(S.layout_card_style, "desktop");
  let gridClass = `grid ${getMobileGridClass(S.mobile_layout_grid_cols)} ${getDesktopGridClass(S.layout_grid_cols)} ${mobileCardStyleClass} ${desktopCardStyleClass} gap-3 sm:gap-6 justify-items-center`;
  const headingPlainText = currentCatalogName ? `${currentCatalogName} \xB7 ${sites.length} \u4E2A\u4E66\u7B7E` : `\u5168\u90E8\u6536\u85CF \xB7 ${sites.length} \u4E2A\u4E66\u7B7E`;
  const headingText = escapeHTML(headingPlainText);
  const headingDefaultAttr = escapeHTML(headingPlainText);
  const headingActiveAttr = catalogExists ? escapeHTML(currentCatalogName) : "";
  const submissionEnabled = String(env.ENABLE_PUBLIC_SUBMISSION) === "true";
  const submissionClass = submissionEnabled ? "" : "!hidden";
  const siteName = S.home_site_name || env.SITE_NAME || "\u6211\u7684\u5BFC\u822A";
  const siteDescription = S.home_site_description || env.SITE_DESCRIPTION || "\u4E00\u4E2A\u4F18\u96C5\u3001\u5FEB\u901F\u3001\u6613\u4E8E\u90E8\u7F72\u7684\u4E66\u7B7E\uFF08\u7F51\u5740\uFF09\u6536\u85CF\u4E0E\u5206\u4EAB\u5E73\u53F0\uFF0C\u5B8C\u5168\u57FA\u4E8E Cloudflare \u5168\u5BB6\u6876\u6784\u5EFA";
  const footerText = S.home_footer_text || env.FOOTER_TEXT || "\u66FE\u68A6\u60F3\u4ED7\u5251\u8D70\u5929\u6DAF";
  const titleStyle = getStyleStr(S.home_title_size, S.home_title_color, S.home_title_font);
  const subtitleStyle = getStyleStr(S.home_subtitle_size, S.home_subtitle_color, S.home_subtitle_font);
  const statsStyle = getStyleStr(S.home_stats_size, S.home_stats_color, S.home_stats_font);
  const hitokotoStyle = getStyleStr(S.home_hitokoto_size, S.home_hitokoto_color, S.home_hitokoto_font);
  const hitokotoContent = S.home_hide_hitokoto ? "" : "\u758F\u5F71\u6A2A\u659C\u6C34\u6E05\u6D45,\u6697\u9999\u6D6E\u52A8\u6708\u9EC4\u660F\u3002";
  const shouldRenderStatsRow = !S.home_hide_stats || !S.home_hide_hitokoto;
  const statsRowPyClass = shouldRenderStatsRow ? "my-8" : "hidden";
  const statsRowHiddenClass = shouldRenderStatsRow ? "" : "hidden";
  const searchEngineOptions = S.home_search_engine_enabled ? `
    <div class="flex justify-center items-center gap-3 mb-4 text-sm select-none search-engine-wrapper">
        <label class="search-engine-option active" data-engine="local"><span>\u7AD9\u5185</span></label>
        <label class="search-engine-option" data-engine="google"><span>Google</span></label>
        <label class="search-engine-option" data-engine="baidu"><span>Baidu</span></label>
        <label class="search-engine-option" data-engine="github"><span>Github</span></label>
    </div>` : "";
  const safeSiteName = escapeHTML(siteName);
  const safeSiteDesc = escapeHTML(siteDescription);
  const horizontalTitleHtml = S.layout_hide_title ? "" : `<h1 class="text-3xl md:text-4xl font-bold tracking-tight mb-3 ${titleColorClass}" ${titleStyle}>${safeSiteName}</h1>`;
  const horizontalSubtitleHtml = S.layout_hide_subtitle ? "" : `<p class="${subTextColorClass} opacity-90 text-sm md:text-base" ${subtitleStyle}>${safeSiteDesc}</p>`;
  const categoryPosition = S.home_category_position;
  const isHorizontalCategoryLayout = categoryPosition !== "left";
  const categoryFlow = S.home_category_flow === "multi_line" ? "multi_line" : "single_line";
  const horizontalCategoryNavShellClass = categoryPosition === "top" ? "horizontal-category-nav-shell is-top relative mx-auto" : "horizontal-category-nav-shell relative mx-auto";
  const horizontalCategoryNavJustifyClass = categoryFlow === "multi_line" ? "justify-start" : "justify-center";
  const horizontalCategoryNavWrapClass = categoryFlow === "multi_line" ? "flex-wrap" : "flex-nowrap";
  const horizontalCategoryNavOverflowClass = "overflow-visible";
  const horizontalCategoryNavFlowClass = categoryFlow === "multi_line" ? "is-multi-line" : "is-single-line";
  const horizontalMoreHtml = categoryFlow === "multi_line" ? "" : `
          <div id="horizontalMoreWrapper" class="relative hidden">
            <button id="horizontalMoreBtn" class="nav-btn inactive">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" /></svg>
            </button>
            <div id="horizontalMoreDropdown" class="dropdown-menu hidden absolute mt-2 w-auto z-50"></div>
          </div>`;
  const horizontalCategoryNavHtml = `
      <div class="${horizontalCategoryNavShellClass}">
        <div id="horizontalCategoryNav" class="flex ${horizontalCategoryNavWrapClass} ${horizontalCategoryNavJustifyClass} items-center gap-3 ${horizontalCategoryNavOverflowClass} ${horizontalCategoryNavFlowClass} transition-all duration-300">
          ${horizontalCatalogMarkup}
          ${horizontalMoreHtml}
        </div>
      </div>`;
  const verticalHeaderContent = `
    <div class="max-w-4xl mx-auto text-center relative z-10 ${themeClass} py-8">
      <div class="home-title-block mb-8">${horizontalTitleHtml}${horizontalSubtitleHtml}</div>
      <div class="home-search-shell relative max-w-xl mx-auto">
        ${searchEngineOptions}
        <div class="home-search-field relative">
          <input type="search" placeholder="\u641C\u7D22\u4E66\u7B7E..." class="search-input-target w-full pl-12 pr-4 py-3.5 rounded-2xl transition-all shadow-lg outline-none focus:outline-none focus:ring-2 ${searchInputClass}" autocomplete="new-password" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="search" enterkeyhint="search" aria-label="\u641C\u7D22\u4E66\u7B7E" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other">
          <svg xmlns="http://www.w3.org/2000/svg" class="home-search-icon h-6 w-6 absolute left-4 top-3.5 ${searchIconClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>
    </div>`;
  const horizontalHeaderContent = `
    <div class="max-w-5xl mx-auto text-center relative z-10 ${themeClass}">
      ${categoryPosition === "top" ? `<div class="category-nav-top-wrap">${horizontalCategoryNavHtml}</div>` : ""}
      <div class="home-title-block max-w-4xl mx-auto mb-8">${horizontalTitleHtml}${horizontalSubtitleHtml}</div>
      ${categoryPosition === "above_search" ? `<div class="mb-8">${horizontalCategoryNavHtml}</div>` : ""}
      <div class="home-search-shell relative max-w-xl mx-auto ${categoryPosition === "below_search" ? "mb-8" : ""}">
        ${searchEngineOptions}
        <div class="home-search-field relative">
          <input id="headerSearchInput" type="search" placeholder="\u641C\u7D22\u4E66\u7B7E..." class="search-input-target w-full pl-12 pr-4 py-3.5 rounded-2xl transition-all shadow-lg outline-none focus:outline-none focus:ring-2 ${searchInputClass}" autocomplete="new-password" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="search" enterkeyhint="search" aria-label="\u641C\u7D22\u4E66\u7B7E" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other">
          <svg xmlns="http://www.w3.org/2000/svg" class="home-search-icon h-6 w-6 absolute left-4 top-3.5 ${searchIconClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>
      ${categoryPosition === "below_search" ? horizontalCategoryNavHtml : ""}
    </div>`;
  let sidebarClass = "";
  let mainClass = "lg:ml-64";
  let sidebarToggleClass = "";
  let mobileToggleVisibilityClass = "lg:hidden";
  let adminIconHtml = "";
  const themeIconHtml = `
    <button id="themeToggleBtn" class="top-action-icon theme-action-icon" title="\u5207\u6362\u4E3B\u9898">
      <svg id="themeIconSun" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="block dark:hidden"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>
      <svg id="themeIconMoon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hidden dark:block"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
    </button>`;
  let headerContent = verticalHeaderContent;
  if (isHorizontalCategoryLayout) {
    sidebarClass = "min-[550px]:hidden";
    mainClass = "";
    sidebarToggleClass = "!hidden";
    mobileToggleVisibilityClass = "min-[550px]:hidden";
    if (!S.home_hide_admin) {
      adminIconHtml = `
        <a href="/admin" target="_blank" class="top-action-icon admin-action-icon" title="\u540E\u53F0\u7BA1\u7406">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M7 18a5 5 0 0 1 10 0"/></svg>
        </a>`;
    }
    headerContent = `
      <div class="min-[550px]:hidden">${verticalHeaderContent}</div>
      <div class="hidden min-[550px]:block">${horizontalHeaderContent}</div>`;
  }
  const topRightActionsHtml = `<div class="fixed top-4 right-4 z-50 flex items-center gap-3">${themeIconHtml}${adminIconHtml}</div>`;
  const leftTopActionHtml = `
    <div class="fixed top-4 left-4 z-50 ${mobileToggleVisibilityClass}">
      <button id="sidebarToggle" class="p-2 rounded-lg bg-white dark:bg-gray-800 shadow-md hover:bg-gray-100 dark:hover:bg-gray-700">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-primary-500 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
    </div>`;
  const footerClass = isCustomWallpaper ? "bg-transparent py-8 px-6 mt-12 border-none shadow-none" : "bg-white py-8 px-6 mt-12 border-t border-primary-100 dark:bg-gray-900 dark:border-gray-800";
  const hitokotoClass = (isCustomWallpaper ? "text-black dark:text-gray-200" : "text-gray-500 dark:text-gray-400") + " ml-auto";
  let html = templateHtml;
  let headInjections = "";
  if (S.home_hide_admin) {
    headInjections += '<style>a[href^="/admin"] { display: none !important; }</style>';
  }
  const safeWallpaperUrl = sanitizeUrl(resolvedWallpaperUrl);
  const defaultBgColor = "#fdf8f3";
  let bgLayerHtml = "";
  if (safeWallpaperUrl) {
    const blurStyle = S.layout_enable_bg_blur ? `filter: blur(${S.layout_bg_blur_intensity}px); transform: scale(1.02);` : "";
    bgLayerHtml = `<div id="fixed-background" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -9999; pointer-events: none; overflow: hidden;"><img src="${safeWallpaperUrl}" alt="" fetchpriority="high" style="width: 100%; height: 100%; object-fit: cover; ${blurStyle}" /></div>`;
  } else {
    bgLayerHtml = `<div id="fixed-background" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -9999; pointer-events: none; background-color: ${defaultBgColor};"></div>`;
  }
  if (safeWallpaperUrl) {
    headInjections += `<link rel="preload" as="image" href="${safeWallpaperUrl}">
`;
  }
  headInjections += `<style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #app-scroll { width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }
    body { background-color: transparent !important; }
    #fixed-background { transition: background-color 0.3s ease, filter 0.3s ease; }
    @supports (-webkit-touch-callout: none) { #fixed-background { height: -webkit-fill-available; } }
  </style>`;
  const cardRadius = normalizeCssPixelValue(S.layout_card_border_radius, 12);
  const mobileCardRadius = normalizeCssPixelValue(S.mobile_layout_card_border_radius, cardRadius);
  const frostedBlur = normalizeCssPixelValue(S.layout_frosted_glass_intensity, 15);
  const mobileFrostedBlur = normalizeCssPixelValue(S.mobile_layout_frosted_glass_intensity, frostedBlur);
  headInjections += `<style>:root { --card-padding: 1.25rem; --card-radius: ${cardRadius}px; --frosted-glass-blur: ${frostedBlur}px; }@media (max-width: 767px) { :root { --card-radius: ${mobileCardRadius}px; --frosted-glass-blur: ${mobileFrostedBlur}px; } }</style>`;
  const usedFonts = /* @__PURE__ */ new Set();
  if (!S.layout_hide_title && S.home_title_font) usedFonts.add(S.home_title_font);
  if (!S.layout_hide_subtitle && S.home_subtitle_font) usedFonts.add(S.home_subtitle_font);
  if (!S.home_hide_stats && S.home_stats_font) usedFonts.add(S.home_stats_font);
  if (!S.home_hide_hitokoto && S.home_hitokoto_font) usedFonts.add(S.home_hitokoto_font);
  if (S.card_title_font) usedFonts.add(S.card_title_font);
  if (S.card_desc_font) usedFonts.add(S.card_desc_font);
  if (S.mobile_card_title_font) usedFonts.add(S.mobile_card_title_font);
  if (S.mobile_card_desc_font) usedFonts.add(S.mobile_card_desc_font);
  let fontLinksHtml = "";
  let needsFontPreconnect = false;
  usedFonts.forEach((font) => {
    if (font && FONT_MAP[font]) {
      fontLinksHtml += `<link rel="stylesheet" href="${FONT_MAP[font]}">`;
      needsFontPreconnect = true;
    }
  });
  const safeCustomFontUrl = sanitizeUrl(S.home_custom_font_url);
  if (safeCustomFontUrl) fontLinksHtml += `<link rel="stylesheet" href="${safeCustomFontUrl}">`;
  if (needsFontPreconnect) headInjections += `<link rel="preconnect" href="https://fonts.loli.net" crossorigin>`;
  if (safeCustomFontUrl) {
    try {
      const customFontOrigin = new URL(safeCustomFontUrl).origin;
      if (customFontOrigin !== "https://fonts.loli.net") {
        headInjections += `<link rel="preconnect" href="${escapeHTML(customFontOrigin)}" crossorigin>`;
      }
    } catch {
    }
  }
  if (env.ICON_API) {
    try {
      const iconOrigin = new URL(env.ICON_API).origin;
      headInjections += `<link rel="preconnect" href="${escapeHTML(iconOrigin)}" crossorigin>`;
    } catch {
    }
  }
  if (fontLinksHtml) headInjections += fontLinksHtml;
  let customCardCss = "";
  const desktopCardTitleStyle = getStyleStr(S.card_title_size, S.card_title_color, S.card_title_font).replace('style="', "").replace('"', "");
  const mobileCardTitleStyle = getStyleStr(S.mobile_card_title_size, S.mobile_card_title_color, S.mobile_card_title_font).replace('style="', "").replace('"', "");
  const desktopCardTitleColor = sanitizeStyleColor(S.card_title_color);
  const mobileCardTitleColor = sanitizeStyleColor(S.mobile_card_title_color);
  const desktopCardDescStyle = getStyleStr(S.card_desc_size, S.card_desc_color, S.card_desc_font).replace('style="', "").replace('"', "");
  const mobileCardDescStyle = getStyleStr(S.mobile_card_desc_size, S.mobile_card_desc_color, S.mobile_card_desc_font).replace('style="', "").replace('"', "");
  if (desktopCardTitleStyle || mobileCardTitleStyle) {
    if (desktopCardTitleStyle) customCardCss += `@media (min-width: 768px) { .site-title { ${desktopCardTitleStyle} } }`;
    if (mobileCardTitleStyle) customCardCss += `@media (max-width: 767px) { .site-title { ${mobileCardTitleStyle} } }`;
  }
  if (desktopCardTitleColor) customCardCss += `@media (min-width: 768px) { body { --desktop-card-title-color: ${desktopCardTitleColor}; } }`;
  if (mobileCardTitleColor) customCardCss += `@media (max-width: 767px) { body { --mobile-card-title-color: ${mobileCardTitleColor}; } }`;
  if (desktopCardDescStyle || mobileCardDescStyle) {
    if (desktopCardDescStyle) customCardCss += `@media (min-width: 768px) { .site-card p { ${desktopCardDescStyle} } }`;
    if (mobileCardDescStyle) customCardCss += `@media (max-width: 767px) { .site-card p { ${mobileCardDescStyle} } }`;
  }
  if (customCardCss) headInjections += `<style>${customCardCss}</style>`;
  const cardHydrationState = buildCardHydrationState(allSites, S);
  const safeSitesJson = JSON.stringify(cardHydrationState.cards).replace(/</g, "\\u003c");
  const safeCardConfigsJson = JSON.stringify(cardHydrationState.configs).replace(/</g, "\\u003c");
  const safeLayoutConfigJson = JSON.stringify({
    hideDesc: S.layout_hide_desc,
    hideLinks: S.layout_hide_links,
    hideCategory: S.layout_hide_category,
    gridCols: S.layout_grid_cols,
    cardStyle: S.layout_card_style,
    cardAnimation: S.layout_card_animation,
    enableFrostedGlass: S.layout_enable_frosted_glass,
    rememberLastCategory: S.home_remember_last_category,
    // 当前 SSR 已渲染的分类（用于前端 Auto-restore 判断是否可跳过重绘）
    ssrCatalogId: catalogExists ? requestedCatalogId : "all"
  }).replace(/</g, "\\u003c");
  html = html.replace("</head>", headInjections + "</head>");
  const pageStyleClasses = [
    S.layout_card_style === "style3" ? "desktop-page-style3" : "",
    S.mobile_layout_card_style === "style3" ? "mobile-page-style3" : "",
    `category-pos-${categoryPosition}`
  ].filter(Boolean).join(" ");
  html = html.replace(
    '<body class="bg-secondary-50 font-sans text-gray-800">',
    `<body class="bg-secondary-50 dark:bg-gray-900 font-sans text-gray-800 dark:text-gray-100 relative ${isCustomWallpaper ? "custom-wallpaper" : ""} ${pageStyleClasses}">${bgLayerHtml}<div id="app-scroll">`
  );
  html = html.replace("</body>", "</div></body>");
  const mainJsMarker = '<script src="/js/main.js';
  if (!html.includes(mainJsMarker)) {
    console.error("Card hydration injection skipped: main.js marker not found in template");
  } else {
    html = html.replace(
      mainJsMarker,
      () => `<script>window.IORI_SITES=${safeSitesJson};window.IORI_CARD_CONFIGS=${safeCardConfigsJson};window.IORI_LAYOUT_CONFIG=${safeLayoutConfigJson};<\/script>
  ${mainJsMarker}`
    );
  }
  const canonicalUrl = `${url.origin}/`;
  const ogImageUrl = `${url.origin}/favicon.svg`;
  const replacements = {
    "HEADER_CONTENT": headerContent,
    "HEADER_CLASS": headerClass,
    "CONTAINER_CLASS": containerClass,
    "FOOTER_CLASS": footerClass,
    "HITOKOTO_CLASS": hitokotoClass,
    "LEFT_TOP_ACTION": leftTopActionHtml,
    "RIGHT_TOP_ACTION": topRightActionsHtml,
    "SITE_NAME": escapeHTML(siteName),
    "SITE_DESCRIPTION": escapeHTML(siteDescription),
    "CANONICAL_URL": escapeHTML(canonicalUrl),
    "OG_IMAGE_URL": escapeHTML(ogImageUrl),
    "FOOTER_TEXT": escapeHTML(footerText),
    "CATALOG_EXISTS": catalogExists ? "true" : "false",
    "CATALOG_LINKS": catalogLinkMarkup,
    "SUBMISSION_CLASS": submissionClass,
    "HEADING_TEXT": headingText,
    "HEADING_DEFAULT": headingDefaultAttr,
    "HEADING_ACTIVE": headingActiveAttr,
    "STATS_VISIBLE": S.home_hide_stats ? "hidden" : "",
    "STATS_STYLE": statsStyle,
    "HITOKOTO_VISIBLE": S.home_hide_hitokoto ? "hidden" : "",
    "STATS_ROW_PY_CLASS": statsRowPyClass,
    "STATS_ROW_HIDDEN": statsRowHiddenClass,
    "HITOKOTO_CONTENT": hitokotoContent,
    "HITOKOTO_STYLE": hitokotoStyle,
    "SITES_GRID": sitesGridMarkup,
    "CURRENT_YEAR": String((/* @__PURE__ */ new Date()).getFullYear()),
    "SIDEBAR_CLASS": sidebarClass,
    "MAIN_CLASS": mainClass,
    "SIDEBAR_TOGGLE_CLASS": sidebarToggleClass
  };
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => replacements[key] ?? "");
  html = html.replace("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6", gridClass);
  html = html.replace(/>\s+</g, "><");
  const response = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": isAuthenticated ? "private, no-store, max-age=0" : "public, max-age=0, must-revalidate"
    }
  });
  if (shouldClearCookie) {
    response.headers.append("Set-Cookie", "iori_cache_stale=; Path=/; Max-Age=0; SameSite=Lax");
    response.headers.append("Set-Cookie", "iori_cache_public_stale=; Path=/; Max-Age=0; SameSite=Lax");
    response.headers.append("Set-Cookie", "iori_cache_private_stale=; Path=/; Max-Age=0; SameSite=Lax");
  }
  if (isHomePage && cacheGeneration !== null) {
    context.waitUntil((async () => {
      try {
        const wrote = await writeHomeCacheIfUnchanged(env, cacheScope, html, cacheGeneration);
        if (wrote && cacheDirty) {
          await clearHomeCacheDirtyIfValue(env, cacheScope, cacheDirtyValue);
        }
      } catch (e) {
        console.warn("Failed to update home cache:", e);
      }
    })());
  }
  return response;
}
__name(onRequest4, "onRequest");

// ../.wrangler/tmp/pages-yEWhk5/functionsRoutes-0.9713180466704878.mjs
var routes = [
  {
    routePath: "/api/backup/webdav",
    mountPath: "/api/backup",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/backup/webdav",
    mountPath: "/api/backup",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/backup/webdav",
    mountPath: "/api/backup",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/cache/clear",
    mountPath: "/api/cache",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/categories/create",
    mountPath: "/api/categories",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/categories/reorder",
    mountPath: "/api/categories",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/config/batch",
    mountPath: "/api/config",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/config/export",
    mountPath: "/api/config",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/config/import",
    mountPath: "/api/config",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/config/submit",
    mountPath: "/api/config",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/api/categories/:id",
    mountPath: "/api/categories",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut]
  },
  {
    routePath: "/api/config/:id",
    mountPath: "/api/config",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete2]
  },
  {
    routePath: "/api/config/:id",
    mountPath: "/api/config",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/config/:id",
    mountPath: "/api/config",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut2]
  },
  {
    routePath: "/api/pending/:id",
    mountPath: "/api/pending",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete3]
  },
  {
    routePath: "/api/pending/:id",
    mountPath: "/api/pending",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut3]
  },
  {
    routePath: "/admin/login",
    mountPath: "/admin",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/admin/login",
    mountPath: "/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost8]
  },
  {
    routePath: "/api/ai-chat",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost9]
  },
  {
    routePath: "/api/categories",
    mountPath: "/api/categories",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/api/config",
    mountPath: "/api/config",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/api/config",
    mountPath: "/api/config",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost10]
  },
  {
    routePath: "/api/get-empty-desc-sites",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet7]
  },
  {
    routePath: "/api/graph",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet8]
  },
  {
    routePath: "/api/pending",
    mountPath: "/api/pending",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet9]
  },
  {
    routePath: "/api/public-config",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet10]
  },
  {
    routePath: "/api/settings",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet11]
  },
  {
    routePath: "/api/settings",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost11]
  },
  {
    routePath: "/api/update-description",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost12]
  },
  {
    routePath: "/api/wallpaper",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet12]
  },
  {
    routePath: "/admin/logout",
    mountPath: "/admin",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/:path*",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  },
  {
    routePath: "/admin",
    mountPath: "/admin",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet13]
  },
  {
    routePath: "/",
    mountPath: "/",
    method: "",
    middlewares: [onRequest],
    modules: [onRequest4]
  }
];

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function getOriginalPathPrefix(requestPath, normalizedPrefix) {
  let end = 0;
  for (let index = 0; index < normalizedPrefix.length; index++) {
    end++;
    if (normalizedPrefix[index] === "/") {
      while (requestPath[end] === "/") {
        end++;
      }
    }
  }
  return requestPath.slice(0, end);
}
__name(getOriginalPathPrefix, "getOriginalPathPrefix");
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  const normalizedRequestPath = requestPath.replace(/\/+/g, "/");
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath) || routeMatcher(normalizedRequestPath);
    const originalMountMatch = mountMatcher(requestPath);
    const mountMatchResult = originalMountMatch || mountMatcher(normalizedRequestPath);
    if (matchResult && mountMatchResult) {
      const path = originalMountMatch ? originalMountMatch.path : getOriginalPathPrefix(requestPath, mountMatchResult.path);
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
