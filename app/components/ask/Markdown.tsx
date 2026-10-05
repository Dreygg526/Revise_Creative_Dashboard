"use client";

import { Fragment, type ReactNode } from "react";

// Just enough markdown for chat answers: paragraphs, headings, bullet and
// numbered lists, tables, **bold**, _italic_ / *italic*, `code`. Anything
// else renders as plain text. "DTC #123" becomes a link when onDtc is given.

type OnDtc = ((dtc: number) => void) | undefined;

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|_[^_\s][^_]*_|\*[^*\s][^*]*\*|DTC\s?#\d+)/g;

function inline(text: string, onDtc: OnDtc, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(<strong key={key} style={{ fontWeight: 600, color: "var(--text)" }}>{inline(tok.slice(2, -2), onDtc, key)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={key} style={{ fontSize: "12px", background: "var(--raised)", padding: "1px 5px", borderRadius: "4px" }}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("DTC")) {
      const n = Number(tok.replace(/\D/g, ""));
      out.push(
        onDtc ? (
          <button
            key={key}
            onClick={() => onDtc(n)}
            title="Open this brief"
            style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#7cb4ff", cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(124,180,255,0.35)", textUnderlineOffset: "2px" }}
          >
            {tok}
          </button>
        ) : (
          tok
        )
      );
    } else {
      out.push(<em key={key}>{inline(tok.slice(1, -1), onDtc, key)}</em>);
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export default function Markdown({ text, onDtc }: { text: string; onDtc?: (dtc: number) => void }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const key = `b${k++}`;

    // Table: header row, divider, body rows.
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      const numeric = head.map((_, c) => rows.length > 0 && rows.every((r) => /^[\s$€£~≈<>+\-−–]*[\d.,]+\s*[%x×]?\s*$|^[—–-]$|^$/.test((r[c] ?? "").replace(/\*\*/g, ""))));
      blocks.push(
        <div key={key} style={{ overflowX: "auto", margin: "4px 0 12px" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "13px", minWidth: "60%" }}>
            <thead>
              <tr>
                {head.map((h, c) => (
                  <th key={c} style={{ textAlign: numeric[c] ? "right" : "left", padding: "6px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {inline(h, onDtc, `${key}h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, c) => (
                    <td key={c} style={{ textAlign: numeric[c] ? "right" : "left", padding: "6px 10px", borderBottom: "1px solid var(--border-soft)", fontVariantNumeric: "tabular-nums", verticalAlign: "top" }}>
                      {inline(r[c] ?? "", onDtc, `${key}r${ri}c${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <div key={key} style={{ fontSize: heading[1].length <= 2 ? "15px" : "14px", fontWeight: 600, margin: "14px 0 6px", color: "var(--text)" }}>
          {inline(heading[2], onDtc, key)}
        </div>
      );
      i++;
      continue;
    }

    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i++].replace(re, "");
        // Continuation lines indented under the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key} style={{ margin: "4px 0 12px", paddingLeft: "20px", listStyle: ordered ? "decimal" : "disc" }}>
          {items.map((it, n) => <li key={n} style={{ marginBottom: "4px" }}>{inline(it, onDtc, `${key}i${n}`)}</li>)}
        </List>
      );
      continue;
    }

    // Paragraph: consecutive plain lines.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isTableRow(lines[i]) && !/^(#{1,4})\s/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) {
      para.push(lines[i++].trim());
    }
    blocks.push(
      <p key={key} style={{ margin: "0 0 10px" }}>
        {para.map((p, n) => (
          <Fragment key={n}>{n > 0 && <br />}{inline(p, onDtc, `${key}p${n}`)}</Fragment>
        ))}
      </p>
    );
  }

  return <div style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--text)" }}>{blocks}</div>;
}
