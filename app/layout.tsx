import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fayda አንባቢ",
  description:
    "Fayda አንባቢ (Amharic: reader) — upload your documents, then ask questions answered from what you've uploaded.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Toaster>
          <TooltipProvider>{children}</TooltipProvider>
        </Toaster>
      </body>
    </html>
  );
}
