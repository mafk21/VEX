export async function register() {
  // Resume any scans that were interrupted by a server restart (local-first = the
  // machine rebooting mid-scan is normal). Runs once per server process.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeIncompleteScans } = await import("@/lib/scanner");
    resumeIncompleteScans();
  }
}
