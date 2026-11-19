import type { ScanRecord, Finding } from "./db";

/** Build a Markdown hunt report for local export. */
export function buildMarkdownReport(scan: ScanRecord, findings: Finding[]): string {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  const duration =
    scan.finishedAt && scan.createdAt
      ? Math.round((new Date(scan.finishedAt).getTime() - new Date(scan.createdAt).getTime()) / 1000)
      : null;

  const lines: string[] = [
    `# VEX Hunt Report — ${scan.repoFullName}`,
    "",
    `| | |`,
    `|---|---|`,
    `| **Scan** | \`${scan.id}\` |`,
    `| **Date** | ${new Date(scan.createdAt).toLocaleString()} |`,
    `| **Mode** | ${scan.mode}${scan.model ? ` (${scan.model})` : ""} |`,
    `| **Status** | ${scan.status} |`,
    duration !== null ? `| **Duration** | ${Math.floor(duration / 60)}m ${duration % 60}s |` : "",
    scan.coverage
      ? `| **Coverage** | ${scan.coverage.files_scanned}/${scan.coverage.files_selected} files scanned (${scan.coverage.files_total} in repo, ~${scan.coverage.est_tokens.toLocaleString()} tokens) |`
      : "",
    "",
    `## Summary`,
    "",
    `| Critical | High | Medium | Low | Info |`,
    `|---|---|---|---|---|`,
    `| ${counts.critical} | ${counts.high} | ${counts.medium} | ${counts.low} | ${counts.info} |`,
    "",
  ].filter((l) => l !== "");

  if (findings.length === 0) {
    lines.push(`## ✓ Clean hunt`, "", "VEX found nothing worth flagging in the scanned files.", "");
    return lines.join("\n");
  }

  const triage = { confirmed: 0, false_positive: 0, ignored: 0, open: 0 };
  for (const f of findings) triage[f.status] = (triage[f.status] ?? 0) + 1;
  if (findings.some((f) => f.status !== "open")) {
    lines.push(
      `**Triage:** ${triage.confirmed} confirmed · ${triage.false_positive} false positive · ${triage.ignored} ignored · ${triage.open} still open`,
      "",
    );
  }

  const bySev = ["critical", "high", "medium", "low", "info"];
  for (const sev of bySev) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(`## ${sev[0].toUpperCase() + sev.slice(1)} (${group.length})`, "");
    group.forEach((f, i) => {
      const loc = `\`${f.filePath}${f.lineStart ? `:${f.lineStart}${f.lineEnd && f.lineEnd !== f.lineStart ? `–${f.lineEnd}` : ""}` : ""}\``;
      lines.push(`### ${i + 1}. ${f.title}`, "");
      lines.push(
        `${loc} · **${f.category}**${f.confidence !== null ? ` · ${(f.confidence * 100).toFixed(0)}% confidence` : ""}${f.status !== "open" ? ` · _${f.status.replace("_", " ")}_` : ""}`,
        "",
      );
      lines.push(f.explanation, "");
      if (f.suggestedFix) {
        lines.push("**Suggested fix**", "", "```", f.suggestedFix, "```", "");
      }
      lines.push("---", "");
    });
  }

  lines.push("", `<sub>Generated locally by VEX — this report never left your machine.</sub>`, "");
  return lines.join("\n");
}
