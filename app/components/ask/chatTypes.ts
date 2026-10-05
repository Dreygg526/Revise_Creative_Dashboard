// Shared shapes for "Ask the dashboard" on the page side: the home view, the
// floating bubble and the sidebar chat list all read the same conversation.

export type FieldValue = string | number | null;

export interface ChangeItem {
  ad_id: string;
  dtc: number | null;
  name: string;
  field: string;
  label: string;
  from: FieldValue;
  to: FieldValue;
}

// One batch of edits Claude proposed. "pending" waits on Approve; with
// confirmation off it arrives already "applied". Undo writes `from` back.
export interface ChangeCard {
  id: string;
  summary: string;
  items: ChangeItem[];
  skipped: string[];                        // changes the validator refused
  status: "pending" | "applying" | "applied" | "cancelled" | "undone" | "failed";
  message?: string;
}

export interface Attachment {
  name: string;
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf";
  data: string;                             // base64; "" once stripped for sessionStorage
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];               // user turns only
  steps?: string[];                         // the lookups behind an answer
  meta?: { tool_calls: number; cost_usd: number; seconds: number };
  images?: string[];                        // thumbnail URLs the tools returned, the only ones drawn
  changes?: ChangeCard[];
  error?: boolean;                          // failed turn: shown, never sent back
}

export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

// What Claude sees of an earlier answer's change cards on the next question,
// so "did that go through?" and "undo that" have something to go on.
export function changeNote(cards: ChangeCard[] | undefined): string {
  if (!cards?.length) return "";
  const word: Record<ChangeCard["status"], string> = {
    pending: "not reviewed yet (nothing changed)",
    applying: "being applied",
    applied: "approved and applied",
    cancelled: "cancelled by the user (nothing changed)",
    undone: "applied, then undone by the user",
    failed: "failed to apply (nothing changed)",
  };
  return (
    "\n\n[Change cards on this answer: " +
    cards.map((c) => `"${c.summary}" (${c.items.length} change${c.items.length === 1 ? "" : "s"}): ${word[c.status]}`).join("; ") +
    "]"
  );
}

export const showValue = (v: FieldValue) => (v == null || v === "" ? "empty" : String(v));

// ---- Attachments ----------------------------------------------------------
// Vercel refuses request bodies over 4.5MB, and every follow-up re-sends the
// conversation, so images are downscaled here and the whole request keeps its
// attachments under this budget (oldest dropped first).
export const ATTACH_BUDGET_CHARS = 3_400_000;   // base64 characters across one request
const MAX_IMAGE_SIDE = 1568;                    // Claude's own useful ceiling
const MAX_PDF_BYTES = 2_500_000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function prepareAttachment(file: File): Promise<Attachment | { error: string }> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) return { error: `${file.name} is ${(file.size / 1e6).toFixed(1)}MB. PDFs can be up to 2.5MB here.` };
    return { name: file.name, media_type: "application/pdf", data: await blobToBase64(file) };
  }
  if (!file.type.startsWith("image/")) return { error: `${file.name}: only images and PDFs can be attached.` };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff"; // transparent PNGs flatten onto white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
      if (blob && (blob.size < 900_000 || q === 0.55)) {
        const base = file.name.replace(/\.[^.]+$/, "");
        return { name: `${base || "image"}.jpg`, media_type: "image/jpeg", data: await blobToBase64(blob) };
      }
    }
    throw new Error("encode failed");
  } catch {
    return { error: `${file.name} couldn't be read as an image.` };
  }
}

export const attachmentSrc = (a: Attachment) => (a.data ? `data:${a.media_type};base64,${a.data}` : "");
