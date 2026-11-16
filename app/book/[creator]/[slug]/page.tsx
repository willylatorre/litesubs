import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { listOpenSlots } from "@/lib/services/bookings";
import { BookingSlotPicker } from "./slot-picker";

export const dynamic = "force-dynamic";

/**
 * Public booking page.
 *
 * Slots are computed on read from the creator's availability, so there is no
 * cache to go stale and no job to fall behind. A signed-out visitor can see the
 * open times; the booking action is what requires sign-in, because it must know
 * whose credits to spend.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ creator: string; slug: string }>;
}): Promise<Metadata> {
	const { creator, slug } = await params;
	const { schedule } = await listOpenSlots(creator, slug);
	if (!schedule) return { title: "Booking not available" };
	return {
		title: `${schedule.name} — book a time`,
		description:
			schedule.description ??
			`Book ${schedule.durationMinutes} minutes on ${schedule.name}.`,
	};
}

export default async function BookPage({
	params,
}: {
	params: Promise<{ creator: string; slug: string }>;
}) {
	const { creator, slug } = await params;
	const { schedule, slots } = await listOpenSlots(creator, slug);
	if (!schedule) notFound();

	const session = await auth.api.getSession({ headers: await headers() });

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<h1 className="text-2xl font-bold tracking-tight">{schedule.name}</h1>
					<Badge variant="outline">{schedule.durationMinutes} min</Badge>
				</div>
				{schedule.description && (
					<p className="text-sm text-muted-foreground">
						{schedule.description}
					</p>
				)}
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<BookingSlotPicker
					scheduleId={schedule.id}
					slots={slots}
					creatorTimeZone={schedule.timezone}
					creditsPerBooking={schedule.creditsPerBooking}
					isSignedIn={Boolean(session?.user)}
				/>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">What you are booking</CardTitle>
						<CardDescription>
							{schedule.creditsPerBooking
								? `${schedule.creditsPerBooking} credit${schedule.creditsPerBooking === 1 ? "" : "s"} are taken from your balance when you confirm. Cancelling returns them if they are still unspent.`
								: "This booking does not spend credits."}
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
						{schedule.plan && (
							<p>
								Plan:{" "}
								<span className="text-foreground">{schedule.plan.name}</span>
							</p>
						)}
						<p>
							Times are shown in your own time zone; the creator&apos;s schedule
							is kept in {schedule.timezone}.
						</p>
						{!session?.user && (
							<p>You need an account to book, because the credits are yours.</p>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
