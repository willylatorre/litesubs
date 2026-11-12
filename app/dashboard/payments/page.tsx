import {
	getPaymentsStatus,
	refreshPaymentsStatus,
} from "@/app/actions/stripe-connect";
import { PaymentsSetup } from "@/components/payments/payments-setup";

export const dynamic = "force-dynamic";

/**
 * Stripe setup/status screen. Onboarding redirects back here with
 * `?onboarding=complete|refresh`, where we re-read Stripe's authoritative
 * readiness instead of trusting the redirect itself.
 */
export default async function PaymentsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const sp = await searchParams;
	if (sp.onboarding === "complete" || sp.onboarding === "refresh")
		await refreshPaymentsStatus();

	const statusRes = await getPaymentsStatus();
	const readiness = statusRes.success ? statusRes.data : null;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Payments</h1>
				<p className="text-muted-foreground text-sm">
					Connect your own Stripe account so customers pay you directly.
				</p>
			</div>
			{readiness ? (
				<PaymentsSetup
					readiness={readiness}
					connectResult={
						typeof sp.connect === "string" ? sp.connect : undefined
					}
				/>
			) : (
				<p className="text-sm text-destructive">
					{statusRes.error ?? "Could not load your payment status."}
				</p>
			)}
		</div>
	);
}
