import { PayoutFAQ } from "@/components/payouts/payout-faq";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

const generalFaqItems = [
	{
		id: "general-what-is-litesubs",
		q: "What is LiteSubs?",
		a: "LiteSubs lets you sell credits instead of traditional subscriptions. Customers buy credits, you assign them to a person, and credits are used only when needed.",
	},
	{
		id: "general-what-are-credits",
		q: "What are credits?",
		a: "Credits are a simple unit of access you define. They can represent anything (sessions, messages, minutes, actions, or usage). You decide how many credits are sold, how much each credit is worth, and how/when credits are consumed.",
	},
	{
		id: "general-one-time-or-recurring",
		q: "Can I sell credits one-time or recurring?",
		a: "Yes. You can offer one-time credit purchases or auto-refill credits (recurring). From the user’s point of view, it’s always just credits.",
	},
	{
		id: "general-subscription-tool",
		q: "Is LiteSubs a subscription tool?",
		a: "Not really — and that’s the point. LiteSubs replaces heavy subscriptions with lighter, more flexible credits. Recurring payments are optional and simply refill credits automatically.",
	},
	{
		id: "general-assigned-to-who",
		q: "Who are credits assigned to?",
		a: "Credits are assigned to a specific person (or customer). That person can then use credits as needed until they run out.",
	},
	{
		id: "general-when-run-out",
		q: "What happens when credits run out?",
		a: "When credits reach zero, usage stops. You can let customers buy more credits, enable auto-refill, or manually top them up — you stay in control.",
	},
	{
		id: "general-what-businesses",
		q: "What kind of businesses is LiteSubs for?",
		a: "LiteSubs works well for consultants & coaches, creators & educators, agencies, internal tools, and SaaS products with usage-based access — anywhere subscriptions feel too rigid.",
	},
	{
		id: "general-account-required",
		q: "Do customers need an account?",
		a: "No — not necessarily. You can share a purchase link and customers can buy credits directly. You decide how lightweight the flow should be.",
	},
	{
		id: "general-payments",
		q: "How does payment work?",
		a: "Payments are handled securely via Stripe. LiteSubs never stores credit card details.",
	},
	{
		id: "general-free",
		q: "Is LiteSubs free?",
		a: "Yes — LiteSubs is free during early access. No credit card is required to get started right now.",
	},
	{
		id: "general-switch-later",
		q: "Can I switch from credits to subscriptions later?",
		a: "You don’t need to. With LiteSubs, subscriptions are just auto-refilling credits. You can evolve your pricing without changing your product model.",
	},
	{
		id: "general-why-credits",
		q: "Why credits instead of subscriptions?",
		a: "Because usage isn’t always predictable — credits adapt, subscriptions don’t.",
	},
] as const;

export default function DashboardFaqPage() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				<div className="flex items-center justify-between px-4 lg:px-6">
					<div className="space-y-1">
						<h1 className="text-2xl font-bold tracking-tight">FAQ</h1>
						<p className="text-sm text-muted-foreground">
							Answers to common questions about LiteSubs and payouts.
						</p>
					</div>
				</div>

				<div className="grid gap-4 px-4 lg:px-6">
					<Card>
						<CardHeader>
							<CardTitle>General</CardTitle>
							<CardDescription>How LiteSubs works at a high level.</CardDescription>
						</CardHeader>
						<CardContent>
							<Accordion type="single" collapsible className="w-full">
								{generalFaqItems.map((item) => (
									<AccordionItem key={item.id} value={item.id}>
										<AccordionTrigger>{item.q}</AccordionTrigger>
										<AccordionContent>{item.a}</AccordionContent>
									</AccordionItem>
								))}
							</Accordion>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Payouts</CardTitle>
							<CardDescription>
								How payouts work and what to expect.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<PayoutFAQ />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}

