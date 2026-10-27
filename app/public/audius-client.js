/**
 * STUDIO — Audius API client (read-only, browser side).
 *
 * Plain fetch against the public Audius API (https://api.audius.co/v1), which
 * allows cross-origin requests. Reads need no key: every call names the app
 * (`app_name`). An owner can add their app's public API key in Options
 * (stored in this browser only); it is sent as `api_key` for the higher rate
 * tier. An app's API secret or bearer token must never be put in a web page,
 * so this module has no place for them.
 *
 * Every call resolves to data or throws an Error whose `audiusClass` is one of
 * "offline", "rate", "notfound", "input" or "error", so the UI can explain it.
 *
 * Old-browser safe (Chrome 95 / Safari 14): no structuredClone, no findLast.
 */

const API = "https://api.audius.co/v1";
const APP_NAME = "STUDIO";
const KEY_STORAGE = "audius_studio_api_key";
const TIMEOUT_MS = 15000;

function classify(err, status) {
  const e = err instanceof Error ? err : new Error(String(err));
  if (status === 429) e.audiusClass = "rate";
  else if (status === 404) e.audiusClass = "notfound";
  else if (status >= 400 && status < 500) e.audiusClass = "input";
  else if (!status) e.audiusClass = "offline";
  else e.audiusClass = "error";
  return e;
}

export function getApiKey() {
  try {
    return (localStorage.getItem(KEY_STORAGE) || "").trim();
  } catch (_) {
    return "";
  }
}

/** Saves the public API key (40 hex characters). Returns false for anything else. */
export function setApiKey(key) {
  const k = String(key || "").trim();
  if (k && !/^[0-9a-fA-F]{40}$/.test(k)) return false;
  try {
    if (k) localStorage.setItem(KEY_STORAGE, k);
    else localStorage.removeItem(KEY_STORAGE);
  } catch (_) {
    return false;
  }
  return true;
}

function buildUrl(path, params) {
  const url = new URL(API + path);
  url.searchParams.set("app_name", APP_NAME);
  const key = getApiKey();
  if (key) url.searchParams.set("api_key", key);
  Object.keys(params || {}).forEach((name) => {
    const value = params[name];
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(name, v));
    else url.searchParams.set(name, value);
  });
  return url.toString();
}

async function getJson(path, params) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : 0;
  let res;
  try {
    res = await fetch(buildUrl(path, params), { signal: controller ? controller.signal : undefined });
  } catch (err) {
    throw classify(new Error("Can't reach Audius. Check your connection."), 0);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = res.status === 429 ? "Audius is rate-limiting requests. Try again in a moment." : res.status === 404 ? "Not found on Audius." : `Audius answered ${res.status}.`;
    throw classify(new Error(msg), res.status);
  }
  const body = await res.json();
  return body && "data" in body ? body.data : body;
}

/** Trending tracks. time: "week" | "month" | "year" | "allTime"; genre optional. */
export function trendingTracks({ time = "week", genre = "", limit = 25 } = {}) {
  return getJson("/tracks/trending", { time, genre, limit });
}

/**
 * Track search. bpmMin/bpmMax narrow to a tempo; downloadable keeps only
 * tracks the artist made downloadable (with or without stems).
 */
export function searchTracks({ query = "", bpmMin, bpmMax, genre = "", downloadable = false, limit = 25 } = {}) {
  return getJson("/tracks/search", {
    query,
    bpm_min: bpmMin,
    bpm_max: bpmMax,
    genre,
    has_downloads: downloadable ? "true" : "",
    limit,
  });
}

/** Official stems of a track: [{ id, parent_id, category, orig_filename, ... }]. */
export function trackStems(trackId) {
  return getJson(`/tracks/${encodeURIComponent(trackId)}/stems`);
}

/** Any audius.co link -> the track, user or playlist it names. */
export function resolveLink(link) {
  return getJson("/resolve", { url: link });
}

/** Streaming URL for previews (redirects to a storage node). */
export function streamUrl(trackId) {
  return buildUrl(`/tracks/${encodeURIComponent(trackId)}/stream`);
}

/** Download URL: only meaningful for downloadable tracks and stems. */
export function downloadUrl(trackId) {
  return buildUrl(`/tracks/${encodeURIComponent(trackId)}/download`);
}

/** Whether the artist allows anyone to download this track right now. */
export function canImport(track) {
  return !!(track && track.is_downloadable && !track.is_download_gated);
}

/** Fetches audio bytes (download for imports). Throws a classified error. */
export async function fetchAudio(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw classify(new Error("Couldn't download the audio from Audius."), 0);
  }
  if (!res.ok) throw classify(new Error(`Audius audio answered ${res.status}.`), res.status);
  return res.arrayBuffer();
}

export function trackArtwork(track) {
  const art = track && track.artwork;
  return (art && (art["150x150"] || art["480x480"])) || "";
}

export function trackLink(track) {
  return track && track.permalink ? `https://audius.co${track.permalink}` : "https://audius.co";
}
