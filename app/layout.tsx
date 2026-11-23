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
	metadataBase: new URL(
		process.env.NEXT_PUBLIC_APP_URL || "https://litesubs.com",
	),
	title: {
		default: "liteSubs",
		// The attribution belongs in the title suffix, not the wordmark.
		template: "%s — liteSubs, by Plannerie",
	},
	description:
		"Simple credit plans instead of heavy subscriptions. Sell one-time credit packs or monthly allowances, charged on your own Stripe account.",
	openGraph: {
		siteName: "liteSubs",
		title: "liteSubs, by Plannerie",
	},
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
			<body className="antialiased light min-h-screen flex flex-col">
				{/* Machine-readable half of "by Plannerie": the product has a maker,
				    and the maker is a separate organization, not a parent brand the
				    product belongs to. */}
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify({
							"@context": "https://schema.org",
							"@type": "Organization",
							name: "liteSubs",
							url: "https://litesubs.com",
							parentOrganization: {
								"@type": "Organization",
								name: "Plannerie",
							},
						}),
					}}
				/>
				<div className="flex-1">{children}</div>
				<Toaster />
			</body>
		</html>
	);
}
