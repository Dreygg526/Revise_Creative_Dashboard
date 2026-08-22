"use client";

import { useState, useEffect } from "react";
import { Sparkles, Copy, Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useMyRole } from "@/app/hooks/useMyRole";
import { useAuth } from "@/app/hooks/useAuth";

interface Generated {
  headlines: string[];
  ad_copies: string[];
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", backgroundColor: "var(--nested)",
  border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text)",
  fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px",
};
// Google's Files API caps a single file at 2GB (20GB per project, 48h retention).
// This is Gemini's limit, not ours — a larger file cannot be uploaded at all.
const GEMINI_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
// What the picker accepts. Deliberately above the Gemini cap so an oversized file
// gets a specific "compress it" message instead of a silent rejection at the picker.
const VIDEO_ACCEPT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
// Chunk size for the resumable upload. Multiple of 256KB, per Google's protocol.
const UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;

const sectionTitle: React.CSSProperties = {
  fontSize: "11px", fontWeight: 600, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px",
};

export default function CopyAgentView() {
  const [inputTab, setInputTab] = useState<"text" | "url" | "image" | "video">("text");
  const [competitorAd, setCompetitorAd] = useState("");
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [controlCopy, setControlCopy] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Generated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMediaType, setImageMediaType] = useState<string>("image/jpeg");
  const [dragging, setDragging] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoNote, setVideoNote] = useState("");
  const [analyzingMedia, setAnalyzingMedia] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const myRole = useMyRole();

  const { session } = useAuth();
  const [selectedHeadline, setSelectedHeadline] = useState<string | null>(null);
  const [selectedCopy, setSelectedCopy] = useState<string | null>(null);
  const [ads, setAds] = useState<Record<string, unknown>[]>([]);
  const [sendAdId, setSendAdId] = useState("");
  const [sending, setSending] = useState(false);
  const [sentToAd, setSentToAd] = useState(false);

  useEffect(() => {
    supabase.from("ads").select("id, ad_name, dtc_number, stage").neq("stage", "Winner / Killed").order("dtc_number", { ascending: false })
      .then(({ data }) => setAds(data ?? []));
  }, []);

  const canGenerate =
    inputTab === "text" ? competitorAd.trim().length > 0 :
    inputTab === "url" ? url.trim().length > 0 :
    inputTab === "image" ? imageBase64 != null :
    videoFile != null;

  function processImage(file: File) {
    if (file.size > 100 * 1024 * 1024) { setError("Image too large — max 100MB"); return; }
    setError(null);
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const MAX_EDGE = 1568;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_EDGE || h > MAX_EDGE) {
        const scale = MAX_EDGE / Math.max(w, h);
        w = Math.round(w * scale); h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL("image/jpeg", 0.9);
      setImagePreview(compressed);
      setImageBase64(compressed.split(",")[1]);
      setImageMediaType("image/jpeg");
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => { setError("Couldn't read that image — try JPG, PNG, or WEBP."); URL.revokeObjectURL(objectUrl); };
    img.src = objectUrl;
  }

  function processVideo(file: File) {
    if (file.size > VIDEO_ACCEPT_MAX_BYTES) { setError("Video too large — max 5GB"); return; }
    // Flag the Gemini ceiling at pick time so nobody waits through an upload to find out.
    setError(
      file.size > GEMINI_MAX_FILE_BYTES
        ? `This file is ${(file.size / 1024 ** 3).toFixed(1)}GB. Gemini can only analyze videos up to 2GB — compress or trim it before generating.`
        : null
    );
    setVideoFile(file);
    setVideoFileName(file.name);
  }

  // NOTE: This uses the Gemini key in the BROWSER (NEXT_PUBLIC_). It is exposed
  // to anyone who inspects the page. Restrict + rotate the key in Google Cloud.
  //
  // Upload is resumable + chunked. The previous version sent the whole file as a
  // single request body, which is all-or-nothing: one dropped connection three
  // quarters of the way through a 2GB upload lost the entire transfer. Chunks are
  // retried individually against an explicit byte offset, so only the failed
  // chunk is resent.
  async function uploadVideoToGemini(file: File, key: string, mimeType: string): Promise<{ fileUri: string; fileName: string }> {
    // Open a resumable session. This request carries headers only — no bytes yet.
    const startRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${key}`,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(file.size),
          "X-Goog-Upload-Header-Content-Type": mimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: file.name } }),
      }
    );
    if (!startRes.ok) throw new Error(`Gemini upload could not start (HTTP ${startRes.status}).`);
    const sessionUrl = startRes.headers.get("X-Goog-Upload-URL");
    if (!sessionUrl) throw new Error("Gemini did not return an upload session URL.");

    let offset = 0;
    let finalData: { file?: { uri?: string; name?: string } } | null = null;

    while (offset < file.size) {
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
      const isLast = end === file.size;
      const headers = {
        "X-Goog-Upload-Offset": String(offset),
        "X-Goog-Upload-Command": isLast ? "upload, finalize" : "upload",
      };

      // Retry this chunk only. The explicit offset makes the request idempotent,
      // so a resend can't duplicate bytes.
      let res: Response | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(sessionUrl, { method: "POST", headers, body: file.slice(offset, end) });
          // 5xx / 408 / 429 are worth another go; other 4xx will not improve.
          if (res.ok || (res.status < 500 && res.status !== 408 && res.status !== 429)) break;
          lastErr = new Error(`HTTP ${res.status}`);
        } catch (e) {
          lastErr = e;
          res = null;
        }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
      if (!res) throw new Error(`Upload stalled at ${Math.round(offset / 1024 / 1024)}MB — ${lastErr instanceof Error ? lastErr.message : "connection lost"}.`);
      if (!res.ok) throw new Error(`Gemini rejected the upload at ${Math.round(offset / 1024 / 1024)}MB (HTTP ${res.status}).`);

      offset = end;
      setUploadPct(Math.round((offset / file.size) * 100));
      if (isLast) finalData = await res.json();
    }

    const fileUri = finalData?.file?.uri;
    const fileName = finalData?.file?.name;
    if (!fileUri || !fileName) throw new Error("Gemini did not return a file URI.");
    return { fileUri, fileName };
  }

  async function analyzeVideoWithGemini(file: File): Promise<string> {
    const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
    if (!key) throw new Error("Missing NEXT_PUBLIC_GEMINI_API_KEY.");
    if (file.size > GEMINI_MAX_FILE_BYTES) {
      throw new Error(
        `That file is ${(file.size / 1024 ** 3).toFixed(1)}GB. Gemini's Files API accepts 2GB per file, so it has to be compressed or trimmed first — exporting at 1080p instead of a master/ProRes file usually gets a video ad well under the limit.`
      );
    }
    const mimeType = file.type || "video/mp4";

    setUploadPct(0);
    let fileUri: string, fileName: string;
    try {
      ({ fileUri, fileName } = await uploadVideoToGemini(file, key, mimeType));
    } finally {
      setUploadPct(null);
    }

    // Gemini transcodes before the file is usable, and that scales with size, so
    // a fixed 3-minute ceiling timed out large-but-valid uploads. Allow ~6 min
    // per GB, floor 3 min, cap 20 min.
    const maxWaitMs = Math.min(20 * 60_000, Math.max(3 * 60_000, (file.size / 1024 ** 3) * 6 * 60_000));
    const deadline = Date.now() + maxWaitMs;
    let active = false;
    while (!active && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      const statusRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${key}`);
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      if (statusData.state === "ACTIVE") active = true;
      // Bail immediately on a rejected file rather than waiting out the deadline.
      else if (statusData.state === "FAILED") throw new Error("Gemini could not process that video — it may be corrupt or an unsupported codec.");
    }
    if (!active) throw new Error(`Video processing timed out after ${Math.round(maxWaitMs / 60_000)} minutes. Try a shorter or smaller video.`);

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [ { file_data: { mime_type: mimeType, file_uri: fileUri } }, { text: `Analyze this competitor video ad. Extract: 1) hook style (first 3 seconds), 2) emotional angle, 3) tone, 4) persuasion technique, 5) any visible text/captions, 6) narrative structure (hook to CTA), 7) formatting patterns (emojis, caps, bullets). Be specific — this will be used to write new ad copy for a different product using the same winning formula.${videoNote ? " Extra context: " + videoNote : ""}` } ] }] }) }
    );
    if (!genRes.ok) throw new Error("Gemini analysis failed.");
    const genData = await genRes.json();
    const analysis = genData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!analysis) throw new Error("Gemini returned an empty analysis.");
    return analysis;
  }

  async function analyzeUrlWithGemini(link: string): Promise<string> {
    const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
    if (!key) return "";
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `Visit and analyze this competitor ad URL: ${link}. Extract hook style, emotional angle, tone, persuasion technique, visible copy, narrative structure, and formatting patterns. Be specific.` }] }], tools: [{ url_context: {} }] }) }
      );
      if (!res.ok) return "";
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch { return ""; }
  }

  async function handleGenerate() {
    setError(null);
    setResult(null);
    setSaved(false);
    setSelectedHeadline(null);
    setSelectedCopy(null);
    setSentToAd(false);
    setGenerating(true);
    try {
      const body =
        inputTab === "text" ? { competitorAd, product, targetAudience, controlCopy } :
        inputTab === "url" ? { competitorAd: `Competitor ad URL: ${url}`, product, targetAudience, controlCopy } :
        { imageBase64, imageMediaType, product, targetAudience, controlCopy };

      const res = await fetch("/api/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Generation failed."); return; }
      setResult({ headlines: json.headlines ?? [], ad_copies: json.ad_copies ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
      setAnalyzingMedia(false);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      let preview: string | null = null;
      if (inputTab === "url") preview = url.trim();
      else if (inputTab === "image") preview = imagePreview;
      else if (inputTab === "video") preview = videoFileName;
      else if (inputTab === "text") preview = competitorAd.trim().slice(0, 200);

      const { error: histErr } = await supabase.from("copy_history").insert({
        ad_name: product || competitorAd.slice(0, 60) || url || videoFileName || "Copy generation",
        generated_by: session?.user?.email ?? null,
        generated_by_role: myRole ?? null,
        headlines: result.headlines,
        ad_copies: result.ad_copies,
        control_copy: controlCopy || null,
        input_type: inputTab,
        input_preview: preview,
        product: product || null,
        target_audience: targetAudience || null,
      });
      if (histErr) { setError("Failed to save: " + histErr.message); setSaving(false); return; }
      setSaved(true);
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function sendToAd() {
    if (!sendAdId || !selectedHeadline || !selectedCopy) return;
    setSending(true);
    const { error: e } = await supabase.from("ads").update({
      selected_headline: selectedHeadline,
      selected_ad_copy: selectedCopy,
    }).eq("id", sendAdId);
    setSending(false);
    if (e) { setError("Failed to send to ad: " + e.message); return; }
    setSentToAd(true);
    setTimeout(() => setSentToAd(false), 3000);
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Copy Agent</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
          Analyze a competitor ad and rewrite it for your product.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* ---- Left: input ---- */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px" }}>
            <div style={sectionTitle}>1 · Competitor ad</div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              {(["text", "url", "image", "video"] as const).map((t) => {
                const active = inputTab === t;
                const labels: Record<string, string> = { text: "Paste text", url: "URL", image: "Image", video: "Video" };
                return (
                  <button key={t} onClick={() => setInputTab(t)} style={{ padding: "5px 12px", borderRadius: "6px", border: active ? "none" : "1px solid var(--border)", backgroundColor: active ? "var(--accent)" : "transparent", color: active ? "#0d0d0f" : "var(--text-secondary)", fontSize: "13px", fontWeight: active ? 600 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                    {labels[t]}
                  </button>
                );
              })}
            </div>

            {inputTab === "text" ? (
              <textarea
                style={{ ...inputStyle, minHeight: "120px", resize: "vertical" }}
                value={competitorAd}
                onChange={(e) => setCompetitorAd(e.target.value)}
                placeholder="Paste the competitor's ad copy, headline, and body exactly as it appears…"
              />
            ) : inputTab === "url" ? (
              <input
                style={inputStyle}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste the competitor's ad URL…"
              />
            ) : inputTab === "image" ? (
              <div>
                {imagePreview ? (
                  <div style={{ position: "relative" }}>
                    <img src={imagePreview} alt="Preview" style={{ width: "100%", height: "160px", objectFit: "cover", borderRadius: "8px", border: "1px solid var(--border)" }} />
                    <button onClick={() => { setImageBase64(null); setImagePreview(null); }} style={{ position: "absolute", top: "8px", right: "8px", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--raised)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px" }}>✕</button>
                  </div>
                ) : (
                  <label
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processImage(f); }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: `2px dashed ${dragging ? "var(--text-muted)" : "var(--border)"}`, borderRadius: "8px", padding: "32px", cursor: "pointer", backgroundColor: dragging ? "var(--hover)" : "transparent" }}
                  >
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)" }}>Drop image or click to upload</span>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>PNG, JPG, WEBP · Max 100MB</span>
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) processImage(f); }} />
                  </label>
                )}
              </div>
            ) : (
              <div>
                {videoFileName ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{videoFileName}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        {uploadPct !== null
                          ? `Uploading to Gemini… ${uploadPct}%`
                          : videoFile
                            ? `${(videoFile.size / 1024 ** 3).toFixed(2)}GB · ${videoFile.size > GEMINI_MAX_FILE_BYTES ? "over Gemini's 2GB limit" : "Ready for analysis"}`
                            : "Ready for analysis"}
                      </div>
                      {uploadPct !== null && (
                        <div style={{ height: "3px", backgroundColor: "var(--raised)", borderRadius: "2px", marginTop: "6px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${uploadPct}%`, backgroundColor: "var(--text-secondary)", transition: "width 0.2s" }} />
                        </div>
                      )}
                    </div>
                    <button onClick={() => { setVideoFile(null); setVideoFileName(null); setError(null); }} style={{ width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--raised)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px" }}>✕</button>
                  </div>
                ) : (
                  <label
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processVideo(f); }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: `2px dashed ${dragging ? "var(--text-muted)" : "var(--border)"}`, borderRadius: "8px", padding: "32px", cursor: "pointer", backgroundColor: dragging ? "var(--hover)" : "transparent" }}
                  >
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)" }}>Drop video or click to upload</span>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>MP4, MOV, AVI · Max 5GB</span>
                    <input type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) processVideo(f); }} />
                  </label>
                )}
                <textarea
                  style={{ ...inputStyle, minHeight: "50px", resize: "vertical", marginTop: "10px" }}
                  value={videoNote}
                  onChange={(e) => setVideoNote(e.target.value)}
                  placeholder="Optional: describe the video or paste any visible copy…"
                />
              </div>
            )}
          </div>

          <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px" }}>
            <div style={sectionTitle}>2 · Your product context</div>
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Your product</label>
              <input style={inputStyle} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. NAC" />
            </div>
            <div>
              <label style={labelStyle}>Target audience</label>
              <input style={inputStyle} value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="e.g. Men 40+, health-conscious" />
            </div>
          </div>

          <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px" }}>
            <div style={sectionTitle}>3 · Previous winning copy (optional)</div>
            <textarea
              style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }}
              value={controlCopy}
              onChange={(e) => setControlCopy(e.target.value)}
              placeholder="Paste your previous winner so the new copy is different enough…"
            />
          </div>

          {error && (
            <div style={{ fontSize: "13px", color: "#fca5a5", backgroundColor: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "8px", padding: "10px 12px" }}>
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              padding: "12px", borderRadius: "8px", border: "none", fontFamily: "inherit",
              fontSize: "14px", fontWeight: 600,
              backgroundColor: canGenerate ? "var(--accent)" : "var(--raised)",
              color: canGenerate ? "#0d0d0f" : "var(--text-muted)",
              cursor: canGenerate && !generating ? "pointer" : "default",
            }}
          >
            <Sparkles size={16} />
            {analyzingMedia ? "Analyzing media…" : generating ? "Writing copy…" : "Analyze & write copy"}
          </button>
        </div>

        {/* ---- Right: output ---- */}
        <div>
          {!result && !generating && (
            <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "40px", textAlign: "center", color: "var(--text-muted)", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px" }}>
              <Sparkles size={28} style={{ marginBottom: "12px", color: "var(--text-muted)" }} />
              <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-secondary)" }}>Ready to analyze</div>
              <div style={{ fontSize: "13px", marginTop: "4px" }}>Paste a competitor ad and hit analyze.</div>
            </div>
          )}

          {generating && (
            <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "40px", textAlign: "center", color: "var(--text-muted)", minHeight: "300px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Writing your copy…</div>
            </div>
          )}

          {result && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px" }}>
                <div style={sectionTitle}>Headlines</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {result.headlines.map((h, i) => (
                    <SelectableBlock key={i} text={h} selected={selectedHeadline === h} onUse={() => setSelectedHeadline(selectedHeadline === h ? null : h)} />
                  ))}
                </div>
              </div>
              <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px" }}>
                <div style={sectionTitle}>Ad copies</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {result.ad_copies.map((c, i) => (
                    <SelectableBlock key={i} text={c} multiline selected={selectedCopy === c} onUse={() => setSelectedCopy(selectedCopy === c ? null : c)} />
                  ))}
                </div>
              </div>

              {selectedHeadline && selectedCopy && (
                <div style={{ backgroundColor: "var(--card)", border: "1px solid #1e3a8a", borderRadius: "10px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.05em" }}>Send to ad</div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Attach the selected headline + copy to an ad so the media buyer sees it.</div>
                  <select value={sendAdId} onChange={(e) => setSendAdId(e.target.value)} style={{ ...inputStyle }}>
                    <option value="">— Select an ad —</option>
                    {ads.map((a) => (
                      <option key={a.id as string} value={a.id as string}>
                        {a.dtc_number != null ? `DTC #${a.dtc_number} · ` : ""}{(a.ad_name as string) || "Untitled"} ({a.stage as string})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={sendToAd}
                    disabled={!sendAdId || sending || sentToAd}
                    style={{ padding: "9px", borderRadius: "8px", border: "none", fontFamily: "inherit", fontSize: "14px", fontWeight: 600, backgroundColor: sentToAd ? "#052e16" : sendAdId ? "#2563eb" : "var(--raised)", color: sentToAd ? "#4ade80" : sendAdId ? "#fff" : "var(--text-muted)", cursor: sendAdId && !sending && !sentToAd ? "pointer" : "default" }}
                  >
                    {sending ? "Sending…" : sentToAd ? "Sent to ad" : "Send to ad"}
                  </button>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving || saved}
                style={{
                  padding: "11px", borderRadius: "8px", border: "none", fontFamily: "inherit",
                  fontSize: "14px", fontWeight: 600,
                  backgroundColor: saved ? "#052e16" : "var(--accent)",
                  color: saved ? "#4ade80" : "#0d0d0f",
                  cursor: saving || saved ? "default" : "pointer",
                }}
              >
                {saving ? "Saving…" : saved ? "Saved to history" : "Save to history"}
              </button>
            </div>
          )}
        </div>
      </div>

      <CopyHistory refreshKey={historyKey} isFounder={myRole === "Founder"} />
    </div>
  );
}

function CopyHistory({ refreshKey, isFounder }: { refreshKey: number; isFounder: boolean }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase.from("copy_history").select("*").order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => { setItems(data ?? []); setLoading(false); });
  }, [refreshKey]);

  async function del(id: string) {
    await supabase.from("copy_history").delete().eq("id", id);
    setItems((prev) => prev.filter((x) => (x.id as string) !== id));
  }

  return (
    <div style={{ marginTop: "40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>Generation history</h2>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{items.length} entries</span>
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}

      {!loading && items.length === 0 && (
        <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px" }}>
          No history yet. Generated copy appears here after you save.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {items.map((item) => {
          const id = item.id as string;
          const open = openId === id;
          const headlines = (item.headlines as string[]) ?? [];
          const copies = (item.ad_copies as string[]) ?? [];
          return (
            <div key={id} style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
              <div onClick={() => setOpenId(open ? null : id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text)" }}>{(item.ad_name as string) || "Untitled"}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {(item.input_type as string) || "text"} · by {(item.generated_by as string) || "—"}{item.generated_by_role ? ` (${item.generated_by_role})` : ""}
                  </div>
                </div>
                {open ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
              </div>
              {open && (
                <div style={{ borderTop: "1px solid var(--border)", padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {headlines.length > 0 && (
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Headlines</div>
                      <div style={{ fontSize: "13px", color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{headlines.join("\n")}</div>
                    </div>
                  )}
                  {copies.length > 0 && (
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Ad copies</div>
                      <div style={{ fontSize: "13px", color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{copies.join("\n\n---\n\n")}</div>
                    </div>
                  )}
                  {isFounder && (
                    <button onClick={() => del(id)} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "5px", background: "none", border: "1px solid var(--border)", borderRadius: "6px", color: "#fca5a5", cursor: "pointer", padding: "5px 10px", fontSize: "12px", fontFamily: "inherit" }}>
                      <Trash2 size={12} /> Delete entry
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectableBlock({ text, multiline, selected, onUse }: { text: string; multiline?: boolean; selected: boolean; onUse: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }
  return (
    <div style={{ backgroundColor: "var(--nested)", border: selected ? "1px solid #4ade80" : "1px solid var(--border)", borderRadius: "8px", padding: "12px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginBottom: "6px" }}>
        <button onClick={copy} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 8px", backgroundColor: "var(--raised)", border: "1px solid var(--border)", borderRadius: "5px", color: copied ? "#4ade80" : "var(--text-secondary)", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={onUse} style={{ padding: "3px 10px", borderRadius: "5px", border: "none", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", backgroundColor: selected ? "#16a34a" : "var(--raised)", color: selected ? "#fff" : "var(--text-secondary)" }}>
          {selected ? "Selected" : "Use this"}
        </button>
      </div>
      <div style={{ fontSize: "14px", color: "var(--text)", lineHeight: 1.5, whiteSpace: multiline ? "pre-wrap" : "normal" }}>{text}</div>
    </div>
  );
}

function CopyBlock({ text, multiline }: { text: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div style={{ backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
        <button onClick={copy} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 8px", backgroundColor: "var(--raised)", border: "1px solid var(--border)", borderRadius: "5px", color: copied ? "#4ade80" : "var(--text-secondary)", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div style={{ fontSize: "14px", color: "var(--text)", lineHeight: 1.5, whiteSpace: multiline ? "pre-wrap" : "normal" }}>{text}</div>
    </div>
  );
}