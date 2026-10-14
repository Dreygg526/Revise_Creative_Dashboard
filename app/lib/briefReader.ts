// Server-only: read a Google Drive brief so Ask AI can turn it into a card
// (Nemanja's ask, 2026-10-14: "I send brief link from google drive → it
// analyzes → it fills in details & creates ad entry → leaves it in Idea").
//
// No Google credentials: the team's brief folders are shared "anyone with the
// link" (300 of 303 Drive brief links are folders, checked 2026-10-14), and
// Drive serves those without a login:
//   embeddedfolderview?id=…  a plain HTML listing of the folder
//   thumbnail?id=…&sz=w…     a rendered image of any file (image, video
//                            cover, PDF first page, doc first page)
//   document/d/…/export      a Google Doc as plain text
// A private folder comes back as a login page, which is reported, not guessed at.

const UA = { "User-Agent": "Mozilla/5.0 (compatible; StandardCreativeDashboard/1.0)" };
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 3_500_000;   // Claude takes 5MB per image; base64 adds a third
const MAX_DOC_CHARS = 20_000;

export interface BriefEntry {
  name: string;
  kind: "image" | "video" | "doc" | "pdf" | "folder" | "other";
  id: string;
}

export interface BriefContent {
  title: string | null;
  entries: BriefEntry[];
  images: { name: string; media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string }[];
  docs: { name: string; text: string }[];
  notes: string[];
}

export class BriefError extends Error {}

function parseLink(url: string): { type: "folder" | "file" | "doc"; id: string } {
  const u = url.trim();
  if (!/^https:\/\/(drive|docs)\.google\.com\//.test(u)) throw new BriefError("That isn't a Google Drive link.");
  const folder = u.match(/\/folders\/([\w-]{10,})/);
  if (folder) return { type: "folder", id: folder[1] };
  const doc = u.match(/docs\.google\.com\/document\/d\/([\w-]{10,})/);
  if (doc) return { type: "doc", id: doc[1] };
  const file = u.match(/\/file\/d\/([\w-]{10,})/) ?? u.match(/[?&]id=([\w-]{10,})/);
  if (file) return { type: "file", id: file[1] };
  throw new BriefError("Couldn't find a folder or file id in that Drive link.");
}

function kindOf(name: string, href: string): BriefEntry["kind"] {
  if (/\/folders\//.test(href)) return "folder";
  if (/docs\.google\.com\/document/.test(href)) return "doc";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm", "avi"].includes(ext)) return "video";
  if (ext === "pdf") return "pdf";
  if (["txt", "docx", "doc"].includes(ext)) return "doc";
  return "other";
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function listFolder(id: string): Promise<{ title: string | null; entries: BriefEntry[] }> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
  const html = await res.text();
  if (!res.ok || /accounts\.google\.com|ServiceLogin/.test(res.url) || !/flip-entr/.test(html)) {
    throw new BriefError("Couldn't open that folder. It's probably not shared as \"anyone with the link\". Change the sharing in Drive and try again.");
  }
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").trim() || null;
  const entries: BriefEntry[] = [];
  for (const m of html.matchAll(/<a href="(https:\/\/[^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g)) {
    const href = decode(m[1]);
    const name = decode(m[2]).trim();
    const fid = href.match(/\/(?:d|folders)\/([\w-]{10,})/)?.[1];
    if (fid) entries.push({ name, kind: kindOf(name, href), id: fid });
  }
  return { title, entries };
}

async function thumbnail(id: string): Promise<BriefContent["images"][number] | null> {
  for (const size of [1568, 1000, 700]) {
    try {
      const res = await fetch(`https://drive.google.com/thumbnail?id=${id}&sz=w${size}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
      const type = (res.headers.get("content-type") ?? "").split(";")[0];
      if (!res.ok || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_BYTES) continue;   // Drive sometimes serves the original; ask for smaller
      return { name: "", media_type: type as BriefContent["images"][number]["media_type"], data: buf.toString("base64") };
    } catch {
      return null;
    }
  }
  return null;
}

async function docText(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("text/plain")) return null;
    return (await res.text()).trim().slice(0, MAX_DOC_CHARS);
  } catch {
    return null;
  }
}

export async function readBrief(url: string): Promise<BriefContent> {
  const link = parseLink(url);
  const out: BriefContent = { title: null, entries: [], images: [], docs: [], notes: [] };

  if (link.type === "doc") {
    const text = await docText(link.id);
    if (text == null) throw new BriefError("Couldn't open that Google Doc. It's probably not shared as \"anyone with the link\".");
    out.docs.push({ name: "Brief doc", text });
    return out;
  }
  if (link.type === "file") {
    const img = await thumbnail(link.id);
    if (!img) throw new BriefError("Couldn't open that file. It's probably not shared as \"anyone with the link\".");
    out.images.push({ ...img, name: "Brief file" });
    return out;
  }

  const top = await listFolder(link.id);
  out.title = top.title;
  out.entries = top.entries;
  // One level of subfolders (e.g. "Statics", "References").
  for (const sub of top.entries.filter((e) => e.kind === "folder").slice(0, 4)) {
    try {
      const inner = await listFolder(sub.id);
      out.entries.push(...inner.entries.filter((e) => e.kind !== "folder").map((e) => ({ ...e, name: `${sub.name}/${e.name}` })));
    } catch {
      out.notes.push(`Subfolder "${sub.name}" couldn't be opened.`);
    }
  }

  const docs = out.entries.filter((e) => e.kind === "doc").slice(0, 3);
  for (const d of docs) {
    const text = await docText(d.id);
    if (text) out.docs.push({ name: d.name, text });
  }
  // Images first, then video covers and PDF first pages, up to MAX_IMAGES.
  const visual = [
    ...out.entries.filter((e) => e.kind === "image"),
    ...out.entries.filter((e) => e.kind === "video" || e.kind === "pdf"),
  ];
  const picked = visual.slice(0, MAX_IMAGES);
  const imgs = await Promise.all(picked.map((e) => thumbnail(e.id)));
  picked.forEach((e, i) => {
    const img = imgs[i];
    if (img) out.images.push({ ...img, name: e.kind === "video" ? `${e.name} (video, cover frame only)` : e.kind === "pdf" ? `${e.name} (PDF, first page)` : e.name });
    else out.notes.push(`${e.name} couldn't be loaded.`);
  });
  if (visual.length > MAX_IMAGES) out.notes.push(`${visual.length - MAX_IMAGES} more file(s) not shown (limit ${MAX_IMAGES}).`);
  if (!out.entries.length) out.notes.push("The folder is empty.");
  return out;
}
