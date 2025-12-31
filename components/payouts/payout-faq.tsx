import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";

export function PayoutFAQ() {
	return (
		<Accordion type="single" collapsible className="w-full">
			<AccordionItem value="item-1">
				<AccordionTrigger>When will I receive my payout?</AccordionTrigger>
				<AccordionContent>
					Payouts typically arrive in 5-7 business days via standard ACH
					transfer. Weekends and holidays may affect processing times.
				</AccordionContent>
			</AccordionItem>
			<AccordionItem value="item-2">
				<AccordionTrigger>Why is my payout pending?</AccordionTrigger>
				<AccordionContent>
					Payouts go through a processing period. Once Stripe confirms the
					transfer, the status will update to "Processing" and then "Completed"
					when funds should be in your account.
				</AccordionContent>
			</AccordionItem>
			<AccordionItem value="item-3">
				<AccordionTrigger>What is the platform fee?</AccordionTrigger>
				<AccordionContent>
					A 1% platform fee is deducted from your gross earnings to cover
					transaction costs and platform maintenance. This is deducted before
					funds are added to your available balance.
				</AccordionContent>
			</AccordionItem>
			<AccordionItem value="item-4">
				<AccordionTrigger>Is there a minimum payout amount?</AccordionTrigger>
				<AccordionContent>
					Yes, the minimum payout amount is $50.00 USD. You must accrue at least
					this amount in available balance before requesting a payout.
				</AccordionContent>
			</AccordionItem>
			<AccordionItem value="item-5">
				<AccordionTrigger>How do I change my bank account?</AccordionTrigger>
				<AccordionContent>
					You can update your bank account details by clicking the "Edit
					Account" or "Setup Payout Account" button, which will redirect you to
					our secure payment processor (Stripe) to manage your details.
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
