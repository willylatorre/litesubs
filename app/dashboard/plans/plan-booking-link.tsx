"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	linkScheduleToPlan,
	listSchedulesForPlan,
} from "@/app/actions/booking-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

/**
 * Native schedule link for a plan (B3).
 *
 * Attaching a schedule here and attaching a plan from the schedule editor write
 * the same columns, so the two surfaces cannot disagree. A price is required
 * when linking: linking without one would quietly make every booking free.
 */
export function PlanBookingLink({
	planId,
	isRecurring,
}: {
	planId: string;
	isRecurring: boolean;
}) {
	const [pending, startTransition] = useTransition();
	const [scheduleId, setScheduleId] = useState<string>("none");
	const [credits, setCredits] = useState<string>("");

	const { data, refetch, isLoading } = useQuery({
		queryKey: ["plan-schedules", planId],
		queryFn: async () => {
			const res = await listSchedulesForPlan(planId);
			if (res.success) return res.data ?? [];
			throw new Error(res.error ?? "Could not load schedules");
		},
		enabled: !isRecurring,
	});

	const schedules = data ?? [];
	const linked = schedules.find((schedule) => schedule.linkedHere);

	function link() {
		if (scheduleId === "none") return;
		startTransition(async () => {
			const result = await linkScheduleToPlan({
				scheduleId,
				planId,
				creditsPerBooking: credits ? Number(credits) : null,
			});
			if (!result.success) {
				toast.error(result.error ?? "Could not link the schedule");
				return;
			}
			toast.success("Schedule linked. Bookings now spend this plan's credits.");
			await refetch();
		});
	}

	function unlink() {
		if (!linked) return;
		startTransition(async () => {
			const result = await linkScheduleToPlan({
				scheduleId: linked.id,
				planId: null,
			});
			if (!result.success) {
				toast.error(result.error ?? "Could not unlink the schedule");
				return;
			}
			toast.success("Schedule unlinked. New bookings are disabled.");
			await refetch();
		});
	}

	if (isRecurring) {
		return (
			<div className="flex flex-col gap-2 border-t pt-4">
				<h3 className="font-semibold">Bookings</h3>
				<p className="text-xs text-muted-foreground">
					A monthly plan cannot be booked: a booking is a single session, not a
					billing period. Use a one-time plan for schedules.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3 border-t pt-4">
			<div>
				<h3 className="font-semibold">Bookings</h3>
				<p className="text-xs text-muted-foreground">
					Link a schedule so a booking spends this plan&apos;s credits.
				</p>
			</div>

			{linked ? (
				<div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
					<span>
						Linked to <span className="font-medium">{linked.name}</span>
					</span>
					{linked.creditsPerBooking && (
						<span className="text-muted-foreground">
							· {linked.creditsPerBooking} credit
							{linked.creditsPerBooking === 1 ? "" : "s"} per booking
						</span>
					)}
					<a
						href={`/book/${linked.slug}`}
						target="_blank"
						rel="noreferrer"
						className="underline underline-offset-4"
					>
						Open booking page
					</a>
					<Button
						variant="ghost"
						size="sm"
						onClick={unlink}
						disabled={pending}
						className="text-muted-foreground"
					>
						Unlink
					</Button>
				</div>
			) : (
				<div className="grid gap-2">
					<Label htmlFor="plan-schedule">Schedule</Label>
					<Select
						value={scheduleId}
						onValueChange={setScheduleId}
						disabled={isLoading || pending || schedules.length === 0}
					>
						<SelectTrigger id="plan-schedule">
							<SelectValue
								placeholder={
									schedules.length === 0
										? "No schedules yet"
										: "Select a schedule"
								}
							/>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="none">No schedule</SelectItem>
							{schedules.map((schedule) => (
								<SelectItem key={schedule.id} value={schedule.id}>
									{schedule.name}
									{schedule.planId && !schedule.linkedHere
										? " (linked to another plan)"
										: ""}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Label htmlFor="plan-schedule-credits">Credits per booking</Label>
					<Input
						id="plan-schedule-credits"
						type="number"
						min={1}
						step={1}
						inputMode="numeric"
						placeholder="Required"
						value={credits}
						onChange={(event) => setCredits(event.target.value)}
					/>
					<Button
						variant="outline"
						size="sm"
						className="w-fit"
						disabled={pending || scheduleId === "none" || !credits}
						onClick={link}
					>
						{pending ? "Linking…" : "Link schedule"}
					</Button>
					{schedules.length === 0 && (
						<p className="text-xs text-muted-foreground">
							Create a schedule in Bookings first, then link it here.
						</p>
					)}
				</div>
			)}
		</div>
	);
}
