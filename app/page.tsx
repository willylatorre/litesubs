import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
	title: "LiteSubs - Simple Credit Plans",
	description:
		"Simple credit plans instead of heavy subscriptions. Sell one-time credit plans or set up auto-refill credits, both in one simple system.",
	openGraph: {
		title: "LiteSubs - Simple Credit Plans",
		description:
			"Simple credit plans instead of heavy subscriptions. Sell one-time credit plans or set up auto-refill credits, both in one simple system.",
		url: "https://litesubs.com",
		siteName: "LiteSubs",
		images: [
			{
				url: "/og-image.png", // Assuming this exists or will exist, usually good practice to define
				width: 1200,
				height: 630,
				alt: "LiteSubs - Simple Credit Plans",
			},
		],
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "LiteSubs - Simple Credit Plans",
		description:
			"Simple credit plans instead of heavy subscriptions. Sell one-time credit bundles or set up auto-refill credits, both in one simple system.",
		creator: "@litesubs", // Placeholder, adjust if known
		images: ["/og-image.png"],
	},
	alternates: {
		canonical: "https://litesubs.com",
	},
};

export default function Home() {
	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "liteSubs - Simple Credit Plans",
		applicationCategory: "BusinessApplication",
		operatingSystem: "Web",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
			description: "Free during early access",
		},
		description:
			"Simple credit plans instead of heavy subscriptions. Sell one-time credit plans or set up auto-refill credits, both in one simple system.",
	};

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
			<LandingPage />
		</>
	);
}