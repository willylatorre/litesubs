"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { getMyBookings } from "@/app/actions/booking-reads";
import { cancelCustomerBooking } from "@/app/actions/bookings";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The customer's own bookings.
 *
 * Cancelling is destructive (it can return credits), so it is confirmed with the
 * effective consequence named: how many credits come back, or that they were
 * already spent. A bare "Are you sure?" would hide the part that matters.
 */
export function MyBookings() {
	const [cancelTarget, setCancelTarget] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const {
		data = [],
		isLoading,
		refetch,
	} = useQuery({
		queryKey: ["my-bookings"],
		queryFn: async () => {
			const res = await getMyBookings();
			return res.success ? (res.data ?? []) : [];
		},
		staleTime: 15_000,
	});

	const now = Date.now();
	const upcoming = data.filter(
		(booking) =>
			booking.status === "confirmed" &&
			new Date(booking.startsAt).getTime() > now,
	);
	const past = data.filter(
		(booking) =>
			!(
				booking.status === "confirmed" &&
				new Date(booking.startsAt).getTime() > now
			),
	);

	function cancel(bookingId: string) {
		startTransition(async () => {
			const result = await cancelCustomerBooking(bookingId);
			if (!result.success) {
				toast.error(result.error ?? "Could not cancel that booking");
				setCancelTarget(null);
				return;
			}
			const restored =
				result.data && "restored" in result.data ? result.data.restored : 0;
			toast.success(
				restored > 0
					? `Booking cancelled. ${restored} credit${restored === 1 ? "" : "s"} returned.`
					: "Booking cancelled. No credits were unspent to return.",
			);
			setCancelTarget(null);
			await refetch();
		});
	}

	const format = (iso: Date | string, timeZone: string) =>
		new Intl.DateTimeFormat(undefined, {
			weekday: "short",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone,
		}).format(new Date(iso));

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</div>
		);
	}

	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-lg font-semibold">Your bookings</h2>
				<p className="text-sm text-muted-foreground">
					Sessions you booked. Cancelling returns credits that are still
					unspent.
				</p>
			</div>

			{upcoming.length === 0 && past.length === 0 ? (
				<p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
					You have no bookings yet. A creator&apos;s booking link will appear
					here once you book a time.
				</p>
			) : (
				<Card>
					<CardContent className="divide-y p-0">
						{[...upcoming, ...past].map((booking) => {
							const isUpcoming =
								booking.status === "confirmed" &&
								new Date(booking.startsAt).getTime() > now;
							return (
								<div
									key={booking.id}
									className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0">
										<p className="font-medium">
											{booking.schedule?.name ?? "Session"}
										</p>
										<p className="text-sm text-muted-foreground">
											{booking.creator?.name
												? `${booking.creator.name} · `
												: ""}
											{format(
												booking.startsAt,
												booking.schedule?.timezone ?? "UTC",
											)}
										</p>
										<p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
											<Badge variant={isUpcoming ? "default" : "outline"}>
												{booking.status === "cancelled"
													? "Cancelled"
													: isUpcoming
														? "Confirmed"
														: "Past"}
											</Badge>
											{booking.chargedCredits > 0 && (
												<span>
													{booking.chargedCredits} credit
													{booking.chargedCredits === 1 ? "" : "s"} spent
												</span>
											)}
										</p>
									</div>
									{isUpcoming && (
										<Button
											variant="outline"
											size="sm"
											disabled={pending}
											onClick={() => setCancelTarget(booking.id)}
										>
											Cancel booking
										</Button>
									)}
								</div>
							);
						})}
					</CardContent>
				</Card>
			)}

			<AlertDialog
				open={cancelTarget !== null}
				onOpenChange={(open) => !open && setCancelTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
						<AlertDialogDescription>
							The time is released for someone else. Credits that are still
							unspent come back to you; credits you already used, or that have
							expired, cannot be returned.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>
							Keep booking
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={pending}
							onClick={(event) => {
								event.preventDefault();
								if (cancelTarget) cancel(cancelTarget);
							}}
						>
							{pending ? "Cancelling…" : "Cancel booking"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
