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
  title: "CubeFeed",
  description: "Never miss a great moment from your favorite cubers.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏆</text></svg>",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@cubing/icons/dist/lib/@cubing/icons/cubing-icons.css"
        />
      </head>
      <body className={`${geist.className} ${dmMono.variable} bg-gray-50 text-gray-900 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
