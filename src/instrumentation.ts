export async function register() {
  // Resume any scans that were interrupted by a server restart (local-first = the
  // machine rebooting mid-scan is normal). Runs once per server process.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeIncompleteScans } = await import("@/lib/scanner");
    resumeIncompleteScans();

    // Graceful shutdown: WAL-mode SQLite is crash-safe; anything still running
    // simply resumes on the next boot via resumeIncompleteScans().
    const onSignal = () => {
      console.log("\n[vex] shutting down — any interrupted hunt resumes on next start.");
      process.exit(0);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }
}
