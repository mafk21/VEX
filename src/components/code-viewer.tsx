"use client";

import { useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";

/**
 * Code viewer: syntax-highlighted, line-numbered, with the flagged line range
 * highlighted and scrolled into view.
 */

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", go: "go", rs: "rust", rb: "ruby", java: "java", kt: "kotlin", kts: "kotlin",
  swift: "swift", php: "php", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp", dart: "dart", sql: "sql", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  json: "json", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", xml: "xml", html: "xml", htm: "xml",
  vue: "xml", svelte: "xml", lua: "lua", r: "r", scala: "scala", ex: "elixir", exs: "elixir",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Props {
  code: string;
  filePath: string;
  highlightStart?: number | null;
  highlightEnd?: number | null;
  maxHeightClass?: string;
}

export default function CodeViewer({ code, filePath, highlightStart, highlightEnd, maxHeightClass = "max-h-[480px]" }: Props) {
  const firstFlagRef = useRef<HTMLDivElement | null>(null);

  const lang = useMemo(() => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const l = EXT_TO_LANG[ext];
    return l && hljs.getLanguage(l) ? l : null;
  }, [filePath]);

  const lines = useMemo(() => {
    const raw = code.split("\n");
    if (!lang) return raw.map((l) => escapeHtml(l));
    // highlight per line, carrying parser continuation so multiline
    // strings/comments stay correctly colored. The continuation API is
    // runtime-supported but absent from hljs's published types.
    const hl = hljs as unknown as {
      highlight(
        code: string,
        opts: { language: string; ignoreIllegals: boolean; continuation?: unknown },
      ): { value: string; _top?: unknown };
    };
    const out: string[] = [];
    let state: unknown;
    for (const line of raw) {
      try {
        const res = hl.highlight(line, { language: lang, ignoreIllegals: true, continuation: state });
        state = res._top;
        out.push(res.value || " ");
      } catch {
        out.push(escapeHtml(line) || " ");
        state = undefined;
      }
    }
    return out;
  }, [code, lang]);

  useEffect(() => {
    firstFlagRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [code, highlightStart]);

  const lo = highlightStart ?? null;
  const hi = highlightEnd ?? highlightStart ?? null;
  const width = String(lines.length).length;

  return (
    <div className={`overflow-auto rounded-lg border border-line bg-void font-mono text-xs leading-5 ${maxHeightClass}`}>
      <div className="min-w-max">
        {lines.map((html, i) => {
          const n = i + 1;
          const flagged = lo !== null && hi !== null && n >= lo && n <= hi;
          return (
            <div
              key={n}
              ref={flagged && (lo === null || n === lo) ? firstFlagRef : undefined}
              className={`flex ${flagged ? "bg-danger/10 shadow-[inset_2px_0_0_var(--color-danger)]" : ""}`}
            >
              <span
                className={`w-${width + 2} shrink-0 pr-4 pl-3 text-right select-none ${flagged ? "text-danger" : "text-ink-dim/40"}`}
                style={{ minWidth: `${width + 2}ch` }}
              >
                {n}
              </span>
              <code className="hljs bg-transparent! pr-4 whitespace-pre" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
