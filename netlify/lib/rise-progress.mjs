// netlify/lib/rise-progress.mjs
//
// Has a learner finished every lesson of a Rise course? (Nathan, 19 Nov
// 2026: lessons first, then the test, as the course itself enforces.)
//
// The course reports progress from the learner's browser, so before a
// certificate is issued we check it ourselves: every lesson listed in the
// course package (scormcontent/runtime-data.js) must show as finished in
// the learner's saved progress (cmi.suspend_data).
//
// suspend_data is Rise's own format: {"v":3,"d":[...]} where d is the
// progress JSON squeezed with LZW. Inside: { cpv, progress: { p, lessons:
// { "0": { c: 1, p: 100, i: {...} }, "1": ... } }, score }, keyed by the
// lesson's position in the course, not its id.

const BASE = (process.env.SUPABASE_URL || "https://yvdmazpxtpuvidlcifnq.supabase.co").replace(/\/+$/, "");

function lzwDecode(codes) {
  const dict = new Map();
  for (let i = 0; i < 256; i++) dict.set(i, String.fromCharCode(i));
  let next = 256;
  let w = String.fromCharCode(codes[0]);
  const out = [w];
  for (let n = 1; n < codes.length; n++) {
    const k = codes[n];
    const entry = dict.has(k) ? dict.get(k) : k === next ? w + w[0] : null;
    if (entry == null) throw new Error("bad progress data");
    out.push(entry);
    dict.set(next++, w + entry[0]);
    w = entry;
  }
  return out.join("");
}

// The learner's saved progress, or null if it cannot be read.
export function readProgress(suspendData) {
  try {
    const outer = typeof suspendData === "string" ? JSON.parse(suspendData) : suspendData;
    if (!outer || !Array.isArray(outer.d) || !outer.d.length) return null;
    return JSON.parse(lzwDecode(outer.d));
  } catch (e) {
    return null;
  }
}

// How many lessons a learner must finish, from the course package.
const cache = new Map();
export async function lessonCount(versionId) {
  if (cache.has(versionId)) return cache.get(versionId);
  const r = await fetch(`${BASE}/storage/v1/object/public/learn/${versionId}/scormcontent/runtime-data.js`);
  if (!r.ok) throw new Error("course package not found (" + r.status + ")");
  const text = await r.text();
  const m = text.match(/__jsonp\(\s*"runtime-data\.js"\s*,\s*"([^"]+)"/);
  if (!m) throw new Error("course package not readable");
  const data = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
  const count = (data.course?.lessons || []).filter((l) => l && !l.deleted && l.type !== "section").length;
  if (!count) throw new Error("course package has no lessons");
  cache.set(versionId, count);
  return count;
}

// { ok, total, finished, missing } — ok only when every lesson is finished.
export async function allLessonsFinished(suspendData, versionId) {
  const total = await lessonCount(versionId);
  const saved = readProgress(suspendData);
  const lessons = saved?.progress?.lessons || {};
  const isDone = (l) => l && (l.c === 1 || l.p === 100);
  const missing = [];
  for (let i = 0; i < total; i++) if (!isDone(lessons[String(i)])) missing.push(i);
  return { ok: !missing.length, total, finished: total - missing.length, missing };
}
