import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIO - Parametric Insurance Operator",
  description: "Hermes-powered parametric insurance demo for rain cover."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
