import "./globals.css";
import { Inter, Montserrat } from "next/font/google";
import Navbar from "@/components/Navbar";
import { cn } from "@/utils/cn";
import { Suspense } from "react";
import Providers from "@/components/Providers";

const inter = Inter({ subsets: ["latin"] });
const montserrat = Montserrat({ subsets: ["latin"] });

export const metadata = {
  title: "Next.js GPT",
  description: "Ask Next.js anything. 🔍",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={cn(
          montserrat.className,
          process.env.NEXT_PUBLIC_DEBUG_SCREENS === "true"
            ? "debug-screens"
            : ""
        )}
      >
        <Providers>
          <Suspense fallback={<p>nav loading...</p>}>
            <Navbar>{children}</Navbar>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
