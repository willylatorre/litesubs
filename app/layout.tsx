import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://litesubs.com"),
	title: "liteSubs",
	description: "Simple credit plans instead of heavy subscriptions. Sell one-time credit plans or set up auto-refill credits, both in one simple system.",
	icons: {
		icon: "/favicon.svg",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
			<body
				className="antialiased light min-h-screen flex flex-col"
			>
				<div className="flex-1">{children}</div>
				<Toaster />
			</body>
		</html>
	);
}
