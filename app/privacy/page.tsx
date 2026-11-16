import type { Metadata } from "next";
import type { LegalSection } from "@/components/legal/legal-document";
import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
	title: "Privacy policy | Litesubs",
	description:
		"What data Litesubs collects, why, who it is shared with, and how creators and customers can exercise their privacy rights.",
	alternates: {
		canonical: "/privacy",
	},
};

const sections: LegalSection[] = [
	{
		id: "scope",
		title: "Scope of this policy",
		blocks: [
			{
				type: "paragraph",
				text: "This Privacy Policy explains how Litesubs collects, uses, and shares personal data when you visit our website, use the dashboard, buy or sell credits, call our API, or connect an AI assistant through our MCP server.",
			},
			{
				type: "paragraph",
				text: "Two relationships exist on the platform, and they matter for your rights. Litesubs is the controller of account and platform data. For the customer lists, credit ledgers, and booking details that a creator manages, the creator is the controller and Litesubs acts as a processor on the creator\u2019s instructions. Requests about data a creator holds about you should normally go to that creator.",
			},
		],
	},
	{
		id: "data-we-collect",
		title: "Data we collect",
		blocks: [
			{ type: "subheading", text: "Account data" },
			{
				type: "list",
				items: [
					"Your name, email address, and a hashed password if you sign up with email. If you sign in with Google, we receive your name, email, and profile image from Google.",
					"Two-factor authentication secrets and recovery state, if you enable them, and passkey credentials if you register a passkey.",
					"Profile settings and preferences you save in the dashboard.",
				],
			},
			{ type: "subheading", text: "Platform and billing data" },
			{
				type: "list",
				items: [
					"Plans, plan versions, and published commercial terms you create.",
					"Enrollments, credit balances, credit grants, consumption receipts, and their idempotency keys.",
					"Transaction and receipt records, including amounts, currency, refunds, and the Stripe identifiers needed to reconcile them.",
					"Stripe connected account identifiers and onboarding status. Litesubs never receives or stores full payment card numbers.",
				],
			},
			{ type: "subheading", text: "Developer and integration data" },
			{
				type: "list",
				items: [
					"API key names, prefixes, scopes, and last-used timestamps. The secret value is shown once and stored only in a form we cannot read back.",
					"Webhook endpoint URLs, subscribed events, and delivery attempts and responses.",
					"OAuth grants and tokens issued to AI assistants or other MCP clients, including the scopes granted and the client identity.",
					"Google Calendar connection metadata and encrypted OAuth tokens, if you connect a calendar for bookings.",
				],
			},
			{ type: "subheading", text: "Usage and technical data" },
			{
				type: "list",
				items: [
					"Server logs containing request paths, timestamps, status codes, IP address, and user agent, kept for security and debugging.",
					"Session and security cookies needed to keep you signed in and to protect forms against cross-site requests.",
					"Emails and notifications we send you, and their delivery status.",
				],
			},
			{
				type: "paragraph",
				text: "We do not run third-party advertising or cross-site tracking scripts, and we do not sell personal data.",
			},
		],
	},
	{
		id: "why",
		title: "Why we use data",
		blocks: [
			{
				type: "paragraph",
				text: "We use personal data to provide and secure the Service and to meet our legal obligations. Specifically:",
			},
			{
				type: "list",
				items: [
					"To create and authenticate accounts, and to enforce permissions and scopes on dashboard, API, and MCP actions.",
					"To record credit grants and consumption accurately, including idempotent retries and receipts.",
					"To publish offers on a creator\u2019s Stripe account, calculate our 2% application fee, and reconcile refunds.",
					"To operate bookings and calendar synchronization when a creator enables them.",
					"To detect abuse, fraud, and security incidents, and to rate-limit automated traffic.",
					"To send transactional email, security alerts, and product notices about material changes.",
					"To comply with tax, accounting, and lawful requests from authorities.",
				],
			},
			{
				type: "paragraph",
				text: "Where data protection law requires a legal basis, we rely on performance of a contract for the Service, our legitimate interests in securing and improving it, your consent for optional integrations and marketing email, and legal obligation for records we must keep.",
			},
		],
	},
	{
		id: "sharing",
		title: "Who we share data with",
		blocks: [
			{
				type: "paragraph",
				text: "We share personal data only with the providers needed to run the Service, and only the data each one needs:",
			},
			{
				type: "list",
				items: [
					"Stripe, for payment processing, connected accounts, application fees, refunds, and payouts. Stripe acts under its own privacy policy.",
					"Google, when you sign in with Google or connect Google Calendar, for authentication and calendar data.",
					"Our hosting and managed database providers, which store the application data described above.",
					"Email delivery providers, to send transactional and security messages.",
					"AI assistants and MCP clients you explicitly authorize through OAuth, limited to the scopes you grant. You can revoke a grant at any time.",
				],
			},
			{
				type: "paragraph",
				text: "We may also disclose data when required by law, to respond to valid legal process, to protect the rights and safety of users or the public, or as part of a merger or acquisition where the recipient is bound to this policy.",
			},
			{
				type: "paragraph",
				text: "Creators see the personal data of customers they enroll: name, email, credit balances, and transaction history for their plans. Buyers see the creator\u2019s plan details. Neither sees data from unrelated creators.",
			},
		],
	},
	{
		id: "cookies",
		title: "Cookies and local storage",
		blocks: [
			{
				type: "paragraph",
				text: "We use a small number of first-party cookies that are required to operate the Service: a session cookie that keeps you signed in, and security cookies that protect authentication and two-factor flows. We do not use advertising cookies or third-party analytics cookies.",
			},
			{
				type: "paragraph",
				text: "If we add optional analytics in the future, we will update this policy and, where required, ask for consent first. Blocking required cookies will prevent sign-in and dashboard use.",
			},
		],
	},
	{
		id: "retention",
		title: "How long we keep data",
		blocks: [
			{
				type: "paragraph",
				text: "We keep account and platform data while your account is active. After closure, we retain records we need for legal, tax, accounting, fraud-prevention, and dispute purposes, including transaction and fee records that must be reconciled with Stripe.",
			},
			{
				type: "paragraph",
				text: "Credit ledger entries are kept for as long as the creator\u2019s account and relevant billing records require, because they substantiate what was sold and consumed. Server logs are kept for a short operational window unless needed for a security investigation. Encrypted calendar tokens are deleted when you disconnect the integration.",
			},
		],
	},
	{
		id: "rights",
		title: "Your rights",
		blocks: [
			{
				type: "paragraph",
				text: "Depending on where you live, you may have the right to access, correct, export, or delete your personal data, to restrict or object to certain processing, and to withdraw consent. If you are in the European Economic Area or the United Kingdom, you also have the right to lodge a complaint with your local supervisory authority.",
			},
			{
				type: "paragraph",
				text: "If you are a California resident, you may request to know what categories of personal information we collect, to delete it, and to correct it. We do not sell personal information or share it for cross-context behavioral advertising, so there is nothing to opt out of on that front.",
			},
			{
				type: "paragraph",
				text: "Send requests to hello@litesubs.com from the email address associated with your account. We may need to verify your identity before acting. Where a request concerns data a creator controls, we will forward it to that creator or tell you to contact them directly.",
			},
		],
	},
	{
		id: "security",
		title: "How we protect data",
		blocks: [
			{
				type: "paragraph",
				text: "Traffic is encrypted in transit, passwords are hashed, API key secrets are not retrievable after creation, and calendar tokens are encrypted at rest with a dedicated key. Access to production systems is limited to people who need it.",
			},
			{
				type: "paragraph",
				text: "No system is perfectly secure. If a breach affects your personal data and the law requires notice, we will contact affected users and any required authority without undue delay.",
			},
		],
	},
	{
		id: "transfers",
		title: "International transfers",
		blocks: [
			{
				type: "paragraph",
				text: "Litesubs and its providers may process data in countries other than yours, including the United States. Where data leaves the EEA or UK, we rely on appropriate safeguards such as standard contractual clauses or an adequacy decision for the receiving country.",
			},
		],
	},
	{
		id: "children",
		title: "Children",
		blocks: [
			{
				type: "paragraph",
				text: "The Service is for adults. You must be at least 18 to create an account, and we do not knowingly collect personal data from children. If you believe a child has provided data to us, contact hello@litesubs.com and we will delete it.",
			},
		],
	},
	{
		id: "changes",
		title: "Changes to this policy",
		blocks: [
			{
				type: "paragraph",
				text: "We may update this policy as the Service changes. Material changes will be announced on the site or by email before they take effect, and the \u201cLast updated\u201d date above will change. Continued use after the effective date means the revised policy applies.",
			},
		],
	},
	{
		id: "contact",
		title: "Contact",
		blocks: [
			{
				type: "paragraph",
				text: "For privacy questions or requests, email hello@litesubs.com. We respond to verifiable requests within the time required by applicable law.",
			},
		],
	},
];

export default function PrivacyPage() {
	return (
		<LegalDocument
			eyebrow="Legal"
			title="Privacy policy"
			summary="The data Litesubs collects to run credit plans, why we need it, and the choices you have over it."
			lastUpdated="November 16, 2026"
			sections={sections}
		/>
	);
}
