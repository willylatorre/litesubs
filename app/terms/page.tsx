import type { Metadata } from "next";
import type { LegalSection } from "@/components/legal/legal-document";
import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
	title: "Terms and conditions | Litesubs",
	description:
		"The agreement between you and Litesubs for using the platform, selling credit plans, and buying credits from creators.",
	alternates: {
		canonical: "/terms",
	},
};

const sections: LegalSection[] = [
	{
		id: "agreement",
		title: "Agreement to these terms",
		blocks: [
			{
				type: "paragraph",
				text: "These Terms and Conditions (the \u201cTerms\u201d) govern your access to and use of Litesubs, including the website, dashboard, booking pages, REST API, and remote MCP server (together, the \u201cService\u201d). By creating an account, publishing a plan, purchasing credits, or otherwise using the Service, you agree to these Terms.",
			},
			{
				type: "paragraph",
				text: "If you use the Service on behalf of a company or other legal entity, you represent that you have authority to bind that entity, and \u201cyou\u201d includes that entity. If you do not agree to these Terms, do not use the Service.",
			},
		],
	},
	{
		id: "the-service",
		title: "What Litesubs does",
		blocks: [
			{
				type: "paragraph",
				text: "Litesubs is a platform that lets creators define credit plans, enroll customers, and track consumption of credits. A plan is either a one-time credit pack or a monthly allowance. Creators prepare a plan as a draft and publish it on their own payment account before anything becomes purchasable.",
			},
			{
				type: "paragraph",
				text: "Litesubs is not a payment processor, bank, escrow agent, or merchant of record. Payments for credit plans are processed by Stripe on the creator\u2019s connected Stripe account, which means:",
			},
			{
				type: "list",
				items: [
					"The contract for the sale of credits is between the creator and the buyer.",
					"The creator is the seller and is solely responsible for the services, content, or access those credits represent.",
					"The creator is responsible for taxes, refunds, chargebacks, and consumer-law obligations arising from their own sales.",
					"Litesubs never stores full payment card details.",
				],
			},
			{
				type: "paragraph",
				text: "Litesubs retains a 2% application fee on each sale made through the platform, charged through Stripe and shown separately in the creator\u2019s Stripe dashboard. Current pricing is described on the site and may change with notice under \u201cChanges to these Terms\u201d.",
			},
		],
	},
	{
		id: "accounts",
		title: "Accounts and security",
		blocks: [
			{
				type: "paragraph",
				text: "You must provide accurate account information and keep it current. You are responsible for activity that occurs under your account, for safeguarding your password, API keys, and OAuth grants, and for promptly notifying us if you believe your credentials have been compromised.",
			},
			{
				type: "paragraph",
				text: "You must be at least 18 years old and legally able to enter into contracts to create an account. We may suspend or terminate accounts that violate these Terms, present a fraud or legal risk, or are required to be restricted by Stripe or applicable law.",
			},
		],
	},
	{
		id: "creators",
		title: "Creator terms",
		blocks: [
			{
				type: "paragraph",
				text: "If you publish plans, you additionally agree that:",
			},
			{
				type: "list",
				items: [
					"You will connect a payment-ready Stripe account and comply with Stripe\u2019s services agreement and prohibited-business requirements.",
					"Published commercial terms are frozen for existing customers. You may edit service details, but changes to price or credits do not retroactively change credits already granted.",
					"You are responsible for delivering whatever the credits represent, for honoring plans you have sold, and for handling customer support and refunds for your own sales.",
					"Refunds are issued from your own Stripe dashboard. When a purchase is refunded, Litesubs revokes the unspent credits from that purchase only.",
					"You will not use the Service to sell credits for unlawful, deceptive, or prohibited goods and services.",
					"You will comply with consumer-protection, subscription, and automatic-renewal laws that apply to your offers, including clear disclosure of recurring charges and cancellation routes for monthly plans.",
				],
			},
			{
				type: "paragraph",
				text: "Monthly plans grant a fresh allowance each paid period. Unless you state otherwise in your plan description, unused monthly credits do not roll over into the next period, and one-time credits do not expire. You are responsible for disclosing credit expiry in the offer you present to buyers.",
			},
		],
	},
	{
		id: "buyers",
		title: "Buyer terms",
		blocks: [
			{
				type: "paragraph",
				text: "If you buy credits, you are purchasing them from the creator, not from Litesubs. Your payment is charged by the creator\u2019s Stripe account. Credits are personal to the enrolled customer and plan, cannot be transferred, and cannot make a balance negative.",
			},
			{
				type: "paragraph",
				text: "Because the creator is the seller, refund requests, service complaints, and questions about what credits unlock should be directed to that creator. If a creator cannot be reached, contact us and we will help where we reasonably can, but we cannot compel a creator to provide a refund we have no authority over.",
			},
			{
				type: "paragraph",
				text: "Where mandatory consumer law gives you rights that cannot be waived, nothing in these Terms limits them. If you are a consumer in a jurisdiction with a statutory cancellation right, that right applies to the creator\u2019s sale.",
			},
		],
	},
	{
		id: "acceptable-use",
		title: "Acceptable use",
		blocks: [
			{
				type: "paragraph",
				text: "You may not use the Service to:",
			},
			{
				type: "list",
				items: [
					"Violate any law, or infringe the rights of others, including intellectual property and privacy rights.",
					"Offer credits for illegal products, regulated goods without required licenses, or content that is fraudulent, abusive, or harmful.",
					"Probe, scan, or test the vulnerability of the Service, or attempt to bypass authentication, scope checks, or credit accounting.",
					"Reverse-engineer, resell, or sublicense the Service except as expressly permitted.",
					"Send unlawful bulk email, or use invite and payment links to harass recipients.",
					"Interfere with the Service or place unreasonable load on it, including through automated API or MCP usage beyond documented limits.",
				],
			},
			{
				type: "paragraph",
				text: "We may remove content, suspend plans, or restrict access where we reasonably believe these rules have been broken, and we will tell you why unless the law or an active investigation prevents it.",
			},
		],
	},
	{
		id: "api-and-mcp",
		title: "API, MCP, and integrations",
		blocks: [
			{
				type: "paragraph",
				text: "The REST API and remote MCP server are provided for programmatic access to the same permission-checked services as the dashboard. API keys and OAuth grants carry scopes; you are responsible for keeping them secret and for only issuing them to systems you control.",
			},
			{
				type: "paragraph",
				text: "Mutation tools may ask a client for confirmation, but that prompt is a usability feature, not a security boundary. Every operation is re-checked server-side against the caller\u2019s permissions. You are responsible for the actions taken with keys and tokens you create.",
			},
			{
				type: "paragraph",
				text: "Integrations with third parties, including Stripe, Google Calendar, and AI assistants, are governed by those third parties\u2019 own terms. We are not responsible for their availability, outages, or changes, though we will make reasonable efforts to keep integrations working.",
			},
		],
	},
	{
		id: "fees-and-billing",
		title: "Fees, credits, and availability",
		blocks: [
			{
				type: "paragraph",
				text: "Litesubs is free to use during early access in the sense described on the site: no subscription fee is charged to creators to access the dashboard. The 2% application fee on completed sales still applies. We may introduce or change fees with advance notice.",
			},
			{
				type: "paragraph",
				text: "We aim to keep the Service available but do not guarantee uninterrupted access. Features may change, and early-access functionality may be modified or withdrawn. We are not liable for delays or failures caused by events outside our reasonable control.",
			},
		],
	},
	{
		id: "termination",
		title: "Suspension and termination",
		blocks: [
			{
				type: "paragraph",
				text: "You may stop using the Service at any time. We may suspend or terminate your access if you materially breach these Terms, if required by law or by Stripe, or if continuing would expose us or other users to harm. Where practical, we will give you notice and an opportunity to resolve the issue.",
			},
			{
				type: "paragraph",
				text: "On termination, plans that need publication may no longer be purchasable, but credits already granted to customers are not automatically extinguished. You remain responsible for honoring obligations you already took on, and for exporting any data you need.",
			},
		],
	},
	{
		id: "disclaimers",
		title: "Disclaimers",
		blocks: [
			{
				type: "paragraph",
				text: "The Service is provided \u201cas is\u201d and \u201cas available\u201d. To the maximum extent permitted by law, Litesubs disclaims all warranties, express or implied, including merchantability, fitness for a particular purpose, non-infringement, and any warranty arising from course of dealing. We do not warrant that the Service will be error-free, that defects will be corrected, or that credit accounting will be uninterrupted.",
			},
			{
				type: "paragraph",
				text: "We are not responsible for the quality, legality, or delivery of any product, service, or content that a creator sells or that credits unlock.",
			},
		],
	},
	{
		id: "liability",
		title: "Limitation of liability",
		blocks: [
			{
				type: "paragraph",
				text: "To the maximum extent permitted by law, Litesubs and its officers, employees, and suppliers will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenue, data, or goodwill, arising from your use of the Service.",
			},
			{
				type: "paragraph",
				text: "Our total aggregate liability for all claims relating to the Service will not exceed the greater of the fees you paid to Litesubs in the twelve months before the event giving rise to the claim, or one hundred US dollars (US$100).",
			},
			{
				type: "paragraph",
				text: "Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you. Nothing in these Terms excludes liability for fraud, willful misconduct, or any other liability that cannot lawfully be excluded.",
			},
		],
	},
	{
		id: "indemnity",
		title: "Indemnity",
		blocks: [
			{
				type: "paragraph",
				text: "You agree to indemnify and hold harmless Litesubs from claims, damages, liabilities, and reasonable legal fees arising from your content, your plans and sales, your violation of these Terms, or your infringement of another party\u2019s rights. If a creator\u2019s offer gives rise to a consumer or regulatory claim, that creator is responsible for defending it.",
			},
		],
	},
	{
		id: "changes",
		title: "Changes to these Terms",
		blocks: [
			{
				type: "paragraph",
				text: "We may update these Terms as the Service evolves. Material changes will be announced on the site or by email before they take effect, and we will update the \u201cLast updated\u201d date above. Continuing to use the Service after the effective date means you accept the revised Terms.",
			},
		],
	},
	{
		id: "governing-law",
		title: "Governing law and disputes",
		blocks: [
			{
				type: "paragraph",
				text: "These Terms are governed by the laws of the State of Delaware, United States, without regard to conflict-of-law rules. You and Litesubs agree to submit to the exclusive jurisdiction of the state and federal courts located in Delaware for disputes arising from the Service, except that either party may bring a claim in small-claims court where eligible.",
			},
			{
				type: "paragraph",
				text: "Before filing a claim, please contact us at hello@litesubs.com and give us 30 days to try to resolve the issue informally.",
			},
			{
				type: "paragraph",
				text: "If a provision of these Terms is found unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. These Terms, together with the Privacy Policy, are the entire agreement between you and Litesubs regarding the Service.",
			},
		],
	},
	{
		id: "contact",
		title: "Contact",
		blocks: [
			{
				type: "paragraph",
				text: "Questions about these Terms, or notices required under them, can be sent to hello@litesubs.com.",
			},
		],
	},
];

export default function TermsPage() {
	return (
		<LegalDocument
			eyebrow="Legal"
			title="Terms and conditions"
			summary="How Litesubs works, what creators and buyers each agree to, and the limits of our responsibility."
			lastUpdated="November 16, 2026"
			sections={sections}
		/>
	);
}
