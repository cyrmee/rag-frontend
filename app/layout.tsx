import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import localFont from "next/font/local";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

// Fayda design system fonts, self-hosted from the exact files served at
// design.fayda.et/design-system: Figtree (Latin body), Nokia Pure Headline
// (Latin headings) + its Ethiopic companion, and Shiromeda Serif (Ethiopic body).
const figtree = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const nokiaPureHeadline = localFont({
  variable: "--font-heading",
  src: [
    { path: "./fonts/NokiaPureHeadline_UltraLight.woff2", weight: "200", style: "normal" },
    { path: "./fonts/NokiaPureHeadline_Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/NokiaPureHeadline_Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/NokiaPureHeadline_Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/NokiaPureHeadline_ExtraBold.woff2", weight: "800", style: "normal" },
  ],
});

const nokiaPureHeadlineEthiopic = localFont({
  variable: "--font-heading-ethiopic",
  src: [
    { path: "./fonts/NokiaPureHeadline_Ethiopic_UltraLight.woff2", weight: "400", style: "normal" },
    { path: "./fonts/NokiaPureHeadline_Ethiopic_Bold.woff2", weight: "700", style: "normal" },
  ],
});

const shiromedaSerif = localFont({
  variable: "--font-ethiopic",
  src: [
    { path: "./fonts/ShiromedaSerif_Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/ShiromedaSerif_Bold.ttf", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Fayda አንባቢ",
  description:
    "Fayda አንባቢ (Amharic: reader) — upload your documents, then ask questions answered from what you've uploaded.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${nokiaPureHeadline.variable} ${nokiaPureHeadlineEthiopic.variable} ${shiromedaSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Toaster>
          <TooltipProvider>{children}</TooltipProvider>
        </Toaster>
      </body>
    </html>
  );
}
