import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";

/**
 * Bookings moved to Plannerie.
 *
 * Scheduling was never the subscription business: it is the teacher's lesson
 * workspace, and it now lives beside the lesson it belongs to. liteSubs keeps
 * the price, the credit grant, and the ledger; see `docs/REFOCUS.md`.
 *
 * This route stays so a link a customer already has — printed on a lesson
 * handout, pasted into a chat — does not turn into a 404. It forwards to the
 * Plannerie schedule when `PLANNERIE_URL` is configured, and otherwise renders
 * a short explanation people can act on.
 */
export const dynamic = "force-dynamic";

export default async function MovedBookingPage({
	params,
}: {
	params: Promise<{ creator: string; slug: string }>;
}) {
	const { creator, slug } = await params;
	const destination = process.env.PLANNERIE_URL;

	if (destination) {
		const target = new URL(
			`/book/${encodeURIComponent(creator)}/${encodeURIComponent(slug)}`,
			destination,
		);
		redirect(target.toString());
	}

	return (
		<main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 p-6">
			<h1 className="text-2xl font-bold tracking-tight">Bookings have moved</h1>
			<p className="text-muted-foreground">
				Scheduling now lives in Plannerie, where your lesson plans are. Your
				credits and payment history stay right here — ask the person who shared
				this link for their new booking address.
			</p>
			<a className="text-sm font-medium underline" href={appUrl("/")}>
				Go to liteSubs
			</a>
		</main>
	);
}
