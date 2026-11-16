"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bookSlot } from "@/app/actions/bookings";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export type PublicSlot = { start: string; end: string };

/**
 * Slot picker for a public booking page.
 *
 * Times are shown in the visitor's own zone, with the creator's zone named
 * beside them. Showing a bare "09:00" when the creator means 09:00 somewhere
 * else is the single most common way to book the wrong hour.
 */
export function BookingSlotPicker({
	scheduleId,
	slots,
	creatorTimeZone,
	creditsPerBooking,
	isSignedIn,
}: {
	scheduleId: string;
	slots: PublicSlot[];
	creatorTimeZone: string;
	creditsPerBooking: number | null;
	isSignedIn: boolean;
}) {
	const [pending, startTransition] = useTransition();
	const [selected, setSelected] = useState<string | null>(null);
	const visitorTimeZone =
		typeof Intl !== "undefined"
			? Intl.DateTimeFormat().resolvedOptions().timeZone
			: creatorTimeZone;

	const format = (iso: string) =>
		new Intl.DateTimeFormat(undefined, {
			weekday: "short",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone: visitorTimeZone,
		}).format(new Date(iso));

	// Group by local date so a long horizon stays readable.
	const groups = slots.reduce<Record<string, PublicSlot[]>>((acc, slot) => {
		const key = new Intl.DateTimeFormat(undefined, {
			weekday: "long",
			month: "long",
			day: "numeric",
			timeZone: visitorTimeZone,
		}).format(new Date(slot.start));
		acc[key] = [...(acc[key] ?? []), slot];
		return acc;
	}, {});

	function book() {
		if (!selected) return;
		startTransition(async () => {
			const result = await bookSlot({ scheduleId, startsAt: selected });
			if (result.success) {
				toast.success("Booking confirmed");
				setSelected(null);
				window.location.reload();
				return;
			}
			if (result.code === "SIGN_IN_REQUIRED") {
				toast.error(result.error ?? "Sign in to book");
				window.location.href = `/auth/sign-in?redirectTo=${encodeURIComponent(window.location.pathname)}`;
				return;
			}
			toast.error(result.error ?? "Could not book that slot");
		});
	}

	if (slots.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">No open times</CardTitle>
					<CardDescription>
						There are no available slots right now. Check back later.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Pick a time</CardTitle>
				<CardDescription>
					Shown in your time zone ({visitorTimeZone})
					{visitorTimeZone !== creatorTimeZone
						? ` · the creator's schedule is in ${creatorTimeZone}`
						: ""}
					{creditsPerBooking
						? ` · each booking spends ${creditsPerBooking} credit${creditsPerBooking === 1 ? "" : "s"}`
						: " · this booking is free"}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
					{Object.entries(groups).map(([day, daySlots]) => (
						<div key={day} className="flex flex-col gap-2">
							<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								{day}
							</p>
							<div className="flex flex-wrap gap-2">
								{daySlots.map((slot) => {
									const active = selected === slot.start;
									return (
										<Button
											key={slot.start}
											type="button"
											size="sm"
											variant={active ? "default" : "outline"}
											aria-pressed={active}
											onClick={() => setSelected(slot.start)}
										>
											{new Intl.DateTimeFormat(undefined, {
												hour: "numeric",
												minute: "2-digit",
												timeZone: visitorTimeZone,
											}).format(new Date(slot.start))}
										</Button>
									);
								})}
							</div>
						</div>
					))}
				</div>
				<Button onClick={book} disabled={!selected || pending}>
					{pending
						? "Booking…"
						: isSignedIn
							? selected
								? `Book ${format(selected)}`
								: "Choose a time"
							: "Sign in to book"}
				</Button>
			</CardContent>
		</Card>
	);
}
