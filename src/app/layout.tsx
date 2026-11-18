import type { Metadata } from "next"
import { Inter, Space_Grotesk } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { env } from "@/lib/env"
import "./globals.css"

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] })
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] })

export const metadata: Metadata = {
  title: `${env.SITE_NAME} | Pick a package`,
  description: `Pick a package and pay with M-Pesa to get connected to ${env.SITE_NAME}.`,
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" closeButton />
      </body>
    </html>
  )
}
