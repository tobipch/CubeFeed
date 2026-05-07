import type { Metadata } from "next";
import { Geist, DM_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

export const metadata: Metadata = {
  title: "CuberFeed",
  description: "Never miss a great moment from your favorite cubers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className={`${geist.className} ${dmMono.variable} bg-gray-50 text-gray-900 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
