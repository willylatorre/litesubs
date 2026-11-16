import { listCreatorSchedules } from "@/app/actions/booking-reads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { MyBookings } from "./my-bookings";

export const dynamic = "force-dynamic";

/**
 * Bookings hub.
 *
 * Shows the customer their own bookings and the creator their schedules. One
 * page serves both roles because most accounts are one or the other, and seeing
 * the other half when it is empty is harmless.
 */
export default async function BookingsPage() {
	const schedulesRes = await listCreatorSchedules();
	const schedules = schedulesRes.success ? (schedulesRes.data ?? []) : [];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
				<p className="text-sm text-muted-foreground">
					Your sessions, and the schedules you offer.
				</p>
			</div>

			<MyBookings />

			<section className="flex flex-col gap-3">
				<div>
					<h2 className="text-lg font-semibold">Your schedules</h2>
					<p className="text-sm text-muted-foreground">
						A schedule is a public booking page. Link it to a plan so a booking
						spends that plan&apos;s credits.
					</p>
				</div>

				{schedules.length === 0 ? (
					<Card>
						<CardHeader>
							<CardTitle className="text-base">No schedules yet</CardTitle>
							<CardDescription>
								Create a schedule to publish a booking page, then link it to a
								one-time plan.
							</CardDescription>
						</CardHeader>
					</Card>
				) : (
					<div className="grid gap-4 md:grid-cols-2">
						{schedules.map((schedule) => (
							<Card key={schedule.id}>
								<CardHeader>
									<div className="flex items-start justify-between gap-3">
										<div className="space-y-1">
											<CardTitle className="text-base">
												{schedule.name}
											</CardTitle>
											<CardDescription>
												{schedule.durationMinutes} min · {schedule.timezone}
											</CardDescription>
										</div>
										<Badge variant={schedule.active ? "default" : "outline"}>
											{schedule.active ? "Open" : "Closed"}
										</Badge>
									</div>
								</CardHeader>
								<CardContent className="flex flex-col gap-3 text-sm">
									<p className="text-muted-foreground">
										{schedule.plan
											? `Linked to ${schedule.plan.name}`
											: "Not linked to a plan, so it cannot take bookings"}
										{schedule.creditsPerBooking
											? ` · ${schedule.creditsPerBooking} credit${
													schedule.creditsPerBooking === 1 ? "" : "s"
												} per booking`
											: ""}
									</p>
									<p className="text-muted-foreground">
										{schedule.upcomingCount} upcoming booking
										{schedule.upcomingCount === 1 ? "" : "s"}
									</p>
									<div className="flex flex-wrap gap-2">
										<Button asChild variant="outline" size="sm">
											<a
												href={`/book/${schedule.creatorHandle}/${schedule.slug}`}
												target="_blank"
												rel="noreferrer"
											>
												Open booking page
											</a>
										</Button>
										<Button asChild variant="ghost" size="sm">
											<a href="/dashboard/plans">Link a plan</a>
										</Button>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
