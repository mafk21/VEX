import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VEX — Local AI Code Hunter",
  description:
    "VEX hunts bugs, vulnerabilities and logic-flow breaks in your GitHub repos. It runs entirely on your machine — your keys and your code never touch a third-party server.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
