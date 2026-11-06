import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { AppProvider } from "@/lib/store";
import Web3Provider from "@/components/Web3Provider";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Modals from "@/components/Modals";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "daemon · agents that work for you",
  description:
    "Subscribe to AI agents that quietly work in the background, or list your own and earn. Wallet-native billing, creator payouts every Friday.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Web3Provider>
          <AppProvider>
            <Header />
            <main className="main">{children}</main>
            <Footer />
            <Modals />
          </AppProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
