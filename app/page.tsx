import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
	title: "LiteSubs - Simple Credit Packs",
	description:
		"Simple credit packs instead of heavy subscriptions. Buy credits, assign them to a person, and let them be used when needed.",
	openGraph: {
		title: "LiteSubs - Simple Credit Packs",
		description:
			"Simple credit packs instead of heavy subscriptions. Buy credits, assign them to a person, and let them be used when needed.",
		url: "https://litesubs.com",
		siteName: "LiteSubs",
		images: [
			{
				url: "/og-image.png", // Assuming this exists or will exist, usually good practice to define
				width: 1200,
				height: 630,
				alt: "LiteSubs - Simple Credit Packs",
			},
		],
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "LiteSubs - Simple Credit Packs",
		description:
			"Simple credit packs instead of heavy subscriptions. Buy credits, assign them to a person, and let them be used when needed.",
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
		name: "LiteSubs",
		applicationCategory: "BusinessApplication",
		operatingSystem: "Web",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
			description: "Free during early access",
		},
		description:
			"Simple credit packs instead of heavy subscriptions. Buy credits, assign them to a person, and let them be used when needed.",
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