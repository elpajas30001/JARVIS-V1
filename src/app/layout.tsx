import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S. — AI Interface",
  description:
    "Just A Rather Very Intelligent System — An Iron Man–styled AI assistant with real tool-calling capabilities.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
