import type { Metadata } from "next";
import { Archivo, Fraunces, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { Gauge, ArrowRight } from "lucide-react";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  style: ["normal", "italic"],
  display: "swap"
});

const sans = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "pio — Parametric Insurance Operations",
  description:
    "A field report on automated, evidence-grounded parametric coverage. Deterministic underwriting and settlement, operated by an agent."
};

const nav = [
  { href: "/ops", label: "Operations" },
  { href: "/agents", label: "Agents" }
];

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${display.variable} ${sans.variable} ${mono.variable} flex min-h-screen flex-col font-sans text-ink`}
      >
        <header className="border-b-2 border-ink bg-card/80 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className="group flex items-baseline gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center border border-ink bg-rain text-card transition-transform group-hover:-rotate-6">
                <Gauge size={15} />
              </span>
              <span className="font-display text-2xl font-semibold leading-none tracking-tight">
                pio
              </span>
            </Link>
            <nav className="flex items-center gap-1 font-mono text-[0.7rem] uppercase tracking-wider">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="border border-transparent px-2.5 py-1 text-ink-soft transition-colors hover:border-line hover:bg-paper/70 hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/buy"
                className="ml-1 inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 font-semibold text-card transition-colors hover:border-rain hover:bg-rain"
              >
                Get Covered
                <ArrowRight size={13} />
              </Link>
            </nav>
          </div>
          <div className="border-t border-line bg-rain text-card">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1 font-mono text-[0.6rem] uppercase tracking-kicker sm:px-6 lg:px-8">
              <span>Version 0.1</span>
              <span className="hidden sm:inline">Evidence-Grounded · Deterministic Settlement</span>
              <span>Stripe Test Mode</span>
            </div>
          </div>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="mt-2 border-t-2 border-ink bg-card/70">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <span>pio · Hackathon Prototype</span>
            <span>Money &amp; claims governed by typed functions, not free-form output.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
