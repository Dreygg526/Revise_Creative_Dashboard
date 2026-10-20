import { NextResponse } from "next/server";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { requireMember, serviceClient } from "@/app/lib/apiAuth";
import { ASK_MODEL, dashboardTools } from "@/app/lib/askDashboard";
import { memberFor } from "@/app/lib/mcpServer";

// Pulling our winners' copy (Triple Whale + Meta) adds ~5-15s before Opus writes.
export const maxDuration = 120;

// How far back "our winning ads" reaches, and how many are shown to the model.
const WINNERS_WINDOW_DAYS = 45;
const WINNERS_LIMIT = 8;

// Social links sit behind a login wall; neither we nor Gemini can read them.
const SOCIAL_HOSTS = /(^|\.)(facebook|fb|instagram|tiktok|threads)\.(com|me|net)$/i;
const PAGE_MAX_CHARS = 30_000;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith("::ffff:127.");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// The URL tab: fetch the page ourselves and hand Claude its real text. Gemini's
// url_context was tried first and, when the site blocked it, made up the page's
// angle instead of failing — so an unreadable page is an error here, never a guess.
async function readPage(raw: string): Promise<{ text: string } | { error: string }> {
  let url: URL;
  try { url = new URL(raw.startsWith("http") ? raw : `https://${raw}`); } catch { return { error: "That doesn't look like a link." }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only http(s) links can be read." };
  if (SOCIAL_HOSTS.test(url.hostname)) {
    return { error: "Facebook, Instagram and TikTok links can't be opened (they need a login). Use a screenshot in the Image tab, the downloaded video in the Video tab, or paste the ad's text in the Text tab." };
  }
  // Members only, but still don't let the server be pointed at its own network.
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(url.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return { error: "That address can't be opened." };
  } catch { return { error: `Couldn't find ${url.hostname}.` }; }

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", Accept: "text/html,*/*" },
    });
  } catch { return { error: "The page didn't answer in time." }; }
  if (!res.ok) return { error: `The page returned HTTP ${res.status}${res.status === 404 ? " (it's gone or the link is wrong)" : res.status === 403 ? " (the site blocks automated reading)" : ""}. Try a screenshot in the Image tab instead.` };
  const html = (await res.text()).slice(0, 3_000_000);
  const meta = (name: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)`, "i"))?.[1] ?? "";
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (body.length < 300) return { error: "That page has almost no readable text (it may load everything with JavaScript or block bots). Try a screenshot in the Image tab instead." };
  const head = [title && `Title: ${title.trim()}`, meta("og:title") && `og:title: ${meta("og:title")}`, meta("description") && `Description: ${meta("description")}`].filter(Boolean).join("\n");
  return { text: `${head}\nURL: ${res.url}\n\n${body.slice(0, PAGE_MAX_CHARS)}` };
}

interface CopyAd {
  brief?: { dtc?: number; name?: string; persona?: string; angle?: string } | null;
  spend?: number;
  nc_roas?: number | null;
  headlines?: string[];
  primary_texts?: string[];
  copy_error?: string;
}

// The real headlines and primary texts of our best ads by NC ROAS, through
// Ask AI's own get_ad_copy tool, so "winning" means the same thing as in the
// chat. Best effort: any failure just means no examples, never no copy.
async function winningCopy(email: string): Promise<string> {
  try {
    const admin = serviceClient();
    if (!admin) return "";
    const member = await memberFor(admin, email);
    if (!member) return "";
    const { tools } = await dashboardTools(admin, member);
    const tool = tools.find((t) => t.name === "get_ad_copy") as BetaRunnableTool<unknown> | undefined;
    if (!tool) return "";
    const start = new Date(Date.now() - WINNERS_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const out = await Promise.race([
      // The tool's max. Most top ads share one primary text (2026-10-20: 12 of
      // the top 12), so pull wide to find WINNERS_LIMIT distinct ones.
      tool.run(tool.parse({ start, rank_by: "nc_roas", limit: 25 })),
      new Promise<null>((r) => setTimeout(() => r(null), 40_000)),
    ]);
    if (typeof out !== "string") return "";
    const ads = ((JSON.parse(out) as { ads?: CopyAd[] }).ads ?? []).filter((a) => !a.copy_error && a.primary_texts?.length);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const a of ads) {
      const body = a.primary_texts![0];
      if (seen.has(body)) continue; // several ads often share one copy
      seen.add(body);
      const b = a.brief;
      lines.push(
        `--- ${b?.dtc ? `DTC #${b.dtc} (${b.name ?? ""})` : "Ad"} · NC ROAS ${a.nc_roas ?? "?"} on $${a.spend ?? 0}${b?.persona ? ` · persona: ${b.persona}` : ""}${b?.angle ? ` · angle: ${b.angle}` : ""}\n` +
          `Headlines: ${(a.headlines ?? []).slice(0, 3).join(" | ") || "(none)"}\n` +
          `Primary text:\n${body.slice(0, 1500)}`
      );
      if (lines.length >= WINNERS_LIMIT) break;
    }
    return lines.join("\n\n");
  } catch (e) {
    console.warn("[generate-copy] winning copy unavailable:", e instanceof Error ? e.message : e);
    return "";
  }
}

// Full copy-formula library (the ~50-brand "copy DNA") — kept server-side.
const PROVEN_COPY_FORMULAS = `
You are trained on the ad copy DNA of 50 top DTC brands. You know exactly how each writes — their tone, structure, hooks, and persuasion techniques. When writing copy, pick the style that best matches the competitor ad and product context.

## BRAND COPY DNA (pick the best match):

**SUPPLEMENTS / HEALTH:**

ANCESTRAL SUPPLEMENTS: Stat hook ("90% of Americans are deficient in...") -> nutrient deficiency problem agitation -> ✅ emoji bullet benefits (grassfed, 3rd-party tested, no fillers) -> science/origin credibility close ("just as our ancestors did"). Tone: educational, earthy, ancestral authority.

HIMS: Social proof number first ("hundreds of thousands of guys") -> "Why Hims?" format -> 📋 emoji bullets -> clinical credibility -> heavy disclaimer footer. Tone: shame-free, direct, medically trustworthy.

RITUAL: Transparency-first ("We'll tell you exactly what's in it and why") -> ingredient-by-ingredient breakdown -> "no BS" positioning -> subscription framing. Tone: clean, feminist, science-backed minimalism.

FEALS: Emotional problem open -> CBD as calm solution -> "meet feals" soft intro -> lifestyle benefit bullets -> free trial CTA. Tone: soft, anxiety-aware, premium calm.

EVERYDAY DOSE: Coffee replacement angle -> "what if your morning routine actually helped you?" -> mushroom science -> before/after energy comparison -> ritual framing. Tone: wellness-curious, anti-hustle, functional.

ARMRA: Immune system gate metaphor -> colostrum science -> "the first food" origin story -> ✅ benefit stack -> "try risk-free" CTA. Tone: scientific but warm, female-skewing health.

HAPPY MAMMOTH: Women's hormonal symptoms called out specifically -> "it's not in your head" validation -> product as hormonal support -> transformation story -> community proof. Tone: empathetic, validating, women's health focused.

PRIMAL HERBS: Ancient herb credibility -> "used for thousands of years" framing -> modern science validation -> ✅ benefit bullets -> ethical sourcing close. Tone: earthy, holistic, nature-authority.

GRUNS: "Finally, a gummy that actually works" -> ingredient transparency -> no sugar/no junk -> taste + function combo -> subscription discount CTA. Tone: playful but credible, millennial health.

HEIGHTS: Brain health specificity -> "most people are deficient in [specific nutrient]" -> cognitive performance angle -> ✅ science bullets -> 30-day trial. Tone: intellectual, performance-focused, UK-premium.

HIYA: Kids' health parent guilt angle -> "most kids' vitamins are basically candy" -> clean ingredients -> pediatrician-approved -> subscribe + save. Tone: protective parent, trust-building, clean label.

KIND PATCHES: Convenience angle -> "no pills, no powders" -> patch technology novelty -> benefit stack -> starter kit CTA. Tone: modern, effortless wellness, lifestyle-first.

SPARTAN: Performance identity -> "you train hard, your supplements should too" -> ingredient dosing specifics -> athlete social proof -> bulk discount CTA. Tone: aggressive, masculine, performance identity.

**FOOD / BEVERAGE:**

RYZE: Morning ritual replacement -> "what if coffee didn't crash you?" -> mushroom coffee positioning -> ✅ benefit comparison (focus, calm, energy) -> 30-day guarantee. Tone: wellness-forward, anti-anxiety, ritual upgrade.

DAVID PROTEIN: Protein density stat ("28g protein, 150 calories") -> macro efficiency angle -> "engineered for performance" -> clean ingredient list -> bulk CTA. Tone: data-driven, performance-first, no fluff.

OATS OVERNIGHT: Time-saving convenience -> "breakfast in 2 minutes" -> nutrition facts comparison vs regular oatmeal -> flavor variety -> subscription. Tone: busy professional, practical, taste-forward.

MASA CHIPS: "Not your average chip" -> traditional nixtamalization process -> heritage + health combo -> clean ingredients -> snack guilt-free positioning. Tone: foodie-curious, heritage-proud, clean snacking.

JAVVY: Coffee + collagen combo novelty -> "your coffee just got an upgrade" -> beauty-from-within angle -> taste credibility -> morning ritual framing. Tone: female wellness, beauty-health overlap, indulgent-but-healthy.

KA'CHAVA: Meal replacement completeness -> "40+ superfoods in one shake" -> replace multiple supplements -> plant-based lifestyle -> transformation story. Tone: complete nutrition, plant-powered, lifestyle transformation.

BREZ: "Finally a social drink without the hangover" -> THC/CBD beverage novelty -> specific occasion framing (parties, dinners) -> taste comparison to alcohol -> try a pack CTA. Tone: social lifestyle, sober-curious, modern alternative.

**BEAUTY / PERSONAL CARE:**

DR. SQUATCH: Pure masculine humor -> pop culture hook -> "tag someone who needs this" community mechanic -> product benefit buried in joke -> never takes itself seriously. Tone: bro-humor, irreverent, viral-first.

LUMIN SKINCARE: Men's skincare without the feminine framing -> "your face deserves better" -> simple routine positioning -> before/after proof -> starter kit. Tone: masculine self-care, accessible, confidence-driven.

NORSE ORGANICS: Beard/hair care masculine identity -> "real men take care of themselves" -> natural ingredients -> ritual framing -> before/after transformation. Tone: rugged-but-refined, natural authority, masculine care.

SOLAWAVE: Skincare technology novelty -> "dermatologist-recommended" credibility -> specific skin problem targeting -> red light science -> results timeline. Tone: tech-forward, results-obsessed, beauty meets science.

TRULY BEAUTY: Bold sensory copy -> fun/playful ingredient names -> body positivity tone -> variety/flavors emphasis -> "treat yourself" CTA. Tone: Gen-Z playful, body-positive, indulgent skincare.

OGEE: Luxury organic positioning -> "the first certified organic luxury skincare" -> ingredient purity -> celebrity/editorial credibility -> premium gift framing. Tone: luxury minimalism, purity-obsessed, aspirational organic.

BLISSY: Sleep quality angle -> silk pillowcase science -> hair + skin benefits while sleeping -> "you deserve this" self-care framing -> gift positioning. Tone: self-care luxury, sleep wellness, deserving framing.

LAURA GELLER: Age-positive beauty -> "makeup that works with your skin, not against it" -> coverage + skincare hybrid -> mature woman confidence -> QVC-style value stacking. Tone: inclusive, age-positive, trusted beauty advisor.

HI-SMILE: Teeth whitening speed claim ("whiter in X uses") -> sensitivity-free positioning -> celebrity/influencer proof -> before/after visual emphasis -> starter kit discount. Tone: confident smile identity, results-fast, accessible luxury.

**PET:**

FARMER'S DOG: Emotional dog owner guilt -> "you wouldn't eat processed food every day" -> fresh food comparison to kibble -> vet-approved credibility -> subscription convenience. Tone: emotional, guilt-to-love, pet parent devotion.

PETLAB CO.: Dog symptom specificity (joint pain, gut health, coat) -> vet-formulated credibility -> before/after dog transformation -> money-back guarantee -> subscription. Tone: concerned pet parent, clinical but warm, results-focused.

**APPAREL / ACCESSORIES:**

MEUNDIES: Comfort identity -> "softest underwear you'll ever wear" -> fabric science (MicroModal) -> matching sets/couples angle -> first pair discount. Tone: playful, comfort-obsessed, couples/gift friendly.

FABLETICS: VIP membership value -> "get 2 leggings for $24" -> celebrity founder credibility -> style + performance combo -> quiz/personalization hook. Tone: aspirational fitness lifestyle, value-forward, membership community.

JAMBYS: Loungewear comfort maximalism -> "the softest pants exist" -> stay-home identity -> gift-perfect framing -> limited colors urgency. Tone: cozy humor, stay-home proud, gifting occasion.

KIZIK: Hands-free shoe technology novelty -> "just step in" -> mobility/convenience angle -> aging-in-place or busy parent targeting -> demo video CTA. Tone: innovation-forward, practical luxury, accessibility.

HOLLOW SOCKS: Comfort + durability claims -> "socks that don't fall down" -> specific pain point (bunching, fading) -> bulk value pack -> satisfaction guarantee. Tone: functional, no-nonsense, everyday upgrade.

CUTS: Premium menswear performance -> "shirts that don't wrinkle, stretch, or fade" -> office-to-gym versatility -> fabric technology -> professional identity. Tone: ambitious professional, performance menswear, quality investment.

GLADE OPTICS: Affordable luxury eyewear -> "why pay $500 for frames?" -> direct-to-consumer disruption -> style variety -> home try-on program. Tone: anti-establishment, value-disruption, style-accessible.

PAIR EYEWEAR: Customizable frames concept -> "one frame, endless tops" -> personality expression -> kids + adults -> subscription of new tops. Tone: playful, self-expression, family-inclusive.

**OTHER:**

HEXCLAD: Gordon Ramsay credibility anchor -> "the last pan you'll ever buy" -> hybrid non-stick technology -> professional-grade for home cooks -> lifetime warranty. Tone: culinary authority, premium investment, chef-endorsed.

BOBBIE: Infant formula trust rebuilding -> "made to EU standards" -> ingredient transparency -> "formula you can feel good about" -> new parent anxiety relief. Tone: trust-rebuilding, parent-protective, premium safety.

GROUNDING WELL: Earthing/grounding science novelty -> "you're disconnected from the earth" -> inflammation reduction claim -> product as reconnection tool -> skeptic-friendly explanation. Tone: alternative wellness, curious-skeptic, nature-reconnection.

LOOP EARPLUGS: Noise reduction without isolation -> "hear what matters, filter what doesn't" -> specific use cases (concerts, focus, sleep, parenting) -> style + function -> starter pack. Tone: modern lifestyle, sensory wellness, design-forward.

HIKE FOOTWEAR: Trail running performance -> "built for the mountain, worn in the city" -> crossover lifestyle -> technical specs in plain language -> adventure identity. Tone: outdoor identity, performance crossover, adventure-aspirational.

CITY BEAUTY: Age-reversal specificity -> "clinically shown to reduce [specific sign of aging]" -> dermatologist formulated -> before/after proof -> results guarantee. Tone: results-obsessed, clinical authority, mature woman empowerment.

PRIMAL QUEEN: Women's hormonal health specifically -> perimenopause/menopause validation -> "finally someone made something for us" -> natural hormone support -> community belonging. Tone: women's health advocacy, validation, age-positive power.

NOVA CERAMICS: Lifestyle upgrade angle -> "your daily [thing] deserves better" -> artisan quality story -> emoji benefit bullets -> urgency discount CTA. Tone: lifestyle elevation, artisan pride, limited-time value.

## CORE COPY FORMULAS (apply within any brand style):

1. STAT HOOK: Lead with a surprising statistic -> explain why it matters -> product as solution
2. GRANDFATHER CONTRAST: "Your grandfather had [X]. He didn't have: ❌ [modern toxin]. You're not weak. You're poisoned."
3. PERMISSION SLIP: "You're not 'just [getting old/tired/sick].' Your [system] crashed."
4. STILL LIST: "✅ Still [enjoy normal thing] ✅ Still [normal life] ✅ No more [bad thing]"
5. VILLAIN FRAME: "Most [category] options leave you hanging. Either [bad A] or [bad B]."
6. STORY BRIDGE: "I was tired of [X], so I built [product]" -> proof -> CTA
7. SOCIAL PROOF SCALE: "[Number] of [people] are already [benefit]"
8. SCIENCE AUTHORITY: "[N] clinically-dosed ingredients. The only [product] that [bold claim]."
9. COMPARISON EMBED: ❌ competitor weakness immediately followed by ✅ our strength — inside the copy
10. RISK REVERSAL: "Try risk-free for [X] days. If you don't [result], we'll refund every penny."
11. MOMENTUM BUILDER: Short. Punchy. One sentence per line. Builds speed to CTA.
12. HOLIDAY/OCCASION: "This [holiday/occasion], don't give them [generic]. Give them [transformation]."
13. BEFORE/AFTER: Vivid before (pain) -> vivid after (transformation) -> product is the bridge
14. CURIOSITY OPEN: "Here's what nobody tells you about [common thing]..."
15. IDENTITY CHALLENGE: "Stop [negative behavior]. Start [positive identity]."

FORMATTING RULES:
- Short sentences. One idea per line when impactful.
- Use ❌ and ✅ for contrast lists INSIDE the copy only.
- Use \\n between paragraphs for breathing room.
- Match the exact tone of the competitor input.
- End with a punchy CTA.
- Add "*Individual results may vary" for health claims.
- If holiday/seasonal context detected, open with that angle.
- Use emojis where they fit the ad style (⭐ 🎉 ⏰ 🔥 ✅ ❌ etc.) — this is Facebook/Meta ad copy and should look punchy and native to the feed.
`;

export async function POST(req: Request) {
  try {
    // Session first, before anything about server config (same rule as every route).
    const admin = serviceClient();
    if (!admin) return NextResponse.json({ error: "Server is missing its database key." }, { status: 500 });
    const auth = await requireMember(req, admin, null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const input = await req.json();
    const { product, targetAudience, controlCopy, analysis, imageBase64, imageMediaType, inputType, pageUrl } = input;
    let competitorAd: string = input.competitorAd ?? "";

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Server is missing the Anthropic API key." }, { status: 500 });
    }

    // Page first: an unreadable link fails fast, before the winners lookup and Opus.
    const page = typeof pageUrl === "string" && pageUrl ? await readPage(pageUrl) : null;
    if (page && "error" in page) return NextResponse.json({ error: page.error }, { status: 422 });
    const winners = await winningCopy(auth.email);
    if (page) competitorAd =`The text of a competitor's ad / landing page (scraped, so expect some menu and footer noise — focus on the ad copy):\n\n${page.text}`;

    const systemPrompt = `You are a world-class direct-response copywriter for DTC health and wellness brands. You write copy that makes people stop scrolling and buy.

${PROVEN_COPY_FORMULAS}

Your job:
1. Analyze the competitor ad input (image, video analysis, text, or URL)
2. Extract their winning FORMULA ONLY — emotional angle, tone, structure, formatting, pacing
3. Pick the BEST proven copy formula that fits OUR product and context
4. Write THREE headlines and THREE full ad copies for OUR product

CRITICAL — ADAPT TO OUR PRODUCT, NOT THEIRS:
- You are borrowing the competitor's STYLE and STRUCTURE, never their product.
- NEVER mention the competitor's product type or format (e.g. gummy, patch, powder, coffee, bar, pouch) UNLESS our product is literally that same format.
- Every product reference, benefit, and offer must be about OUR product: "${product || "our product"}".
- If the competitor sells a gummy and we sell NAC capsules, the copy is about NAC — not gummies.
- Rewrite ALL specifics (ingredients, form factor, benefits, offers) to fit OUR product truthfully.

HEADLINES:
- 5-12 words maximum
- Punchy, scroll-stopping, emotionally charged
- Match the tone of the competitor (bold, clinical, empathetic, etc.)

AD COPY:
- Full narrative direct-response copy
- Use one of the proven formulas above — pick the best fit
- Embed comparison (❌/✅) INSIDE the copy naturally
- Use \\n between paragraphs for line breaks
- Use emojis where they fit the ad style — this is real Facebook ad copy
- End with a strong CTA
- Length: medium — substantial but not bloated
- If the input mentions a holiday, season, or event, make the copy relevant to it

CRITICAL OUTPUT RULES:
- Output ONLY a raw JSON object. Nothing before it. Nothing after it.
- No markdown. No backticks. No preamble. No explanation.
- The entire response must be parseable by JSON.parse()
- Format: {"headlines":["headline 1","headline 2","headline 3"],"ad_copies":["full ad copy 1","full ad copy 2","full ad copy 3"]}
- Never mention competitor brands by name.
- If you write anything outside the JSON object, you have failed.

IF THE VIDEO IS OUR OWN AD (The Standard Lab / our NAC product is what's shown):
- Don't borrow a formula — write the primary text that runs WITH this video.
- Open on the same hook the video opens on, echo its voiceover lines and on-screen claims, keep the same persona and angle, and land on the same offer/CTA. The copy and the video must read as one ad.

OUR WINNING ADS:
- If examples of our own top ads by NC ROAS are given, they are the house style that actually converts for our customers (mostly men and women 40+ with liver, belly-fat, bloating and drinking worries).
- Match their voice, length, structure, emoji use and the way they open and close. Don't copy them line for line, and don't reuse their exact headlines.`;

    const contextInfo = `Product: ${product || "same product category as the competitor ad"}
Target Audience: ${targetAudience || "same target audience as the competitor ad"}
${controlCopy ? `Previous Winning Copy (make new copy different enough): ${controlCopy}` : ""}${
      winners ? `\n\nOUR TOP ADS BY NC ROAS, LAST ${WINNERS_WINDOW_DAYS} DAYS (real copy from Meta — write like these):\n\n${winners}` : ""
    }`;

    // Build the user message. Image goes as a vision block; everything else as text.
    let userContent: unknown;
    if (imageBase64) {
      userContent = [
        { type: "image", source: { type: "base64", media_type: imageMediaType || "image/jpeg", data: imageBase64 } },
        { type: "text", text: `This is a competitor's winning ad. Analyze their formula, tone, formatting, and emotional angle. Then write 3 headlines and 3 full ad copies for our product using the best proven formula.\n\n${contextInfo}` },
      ];
    } else if (analysis) {
      const source = inputType === "video" ? "A video ad was watched and broken down (transcript, on-screen text, scenes)" : "An ad was analyzed";
      userContent = `${source}:\n\n${analysis}\n\n${contextInfo}\n\nFirst decide whether this is our own ad or a competitor's. Then write 3 headlines and 3 ad copies for our product — matching the video if it's ours, borrowing the winning formula if it's a competitor's.`;
    } else {
      userContent = `Competitor's winning ad copy:\n${competitorAd}\n\nAnalyze their formula — emotional trigger, formatting, tone, structure. Pick the best proven formula and write 3 headlines and 3 ad copies for our product.\n\n${contextInfo}`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ASK_MODEL,
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `Claude request failed: ${errText}` }, { status: 502 });
    }

    const data = await response.json();
    // The first block isn't always text (thinking can come first), so take the text ones.
    const raw = ((data.content ?? []) as { type: string; text?: string }[])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "No valid JSON in the AI response." }, { status: 502 });
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "Failed to parse the AI response." }, { status: 502 });
    }
    return NextResponse.json({ headlines: parsed.headlines ?? [], ad_copies: parsed.ad_copies ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}