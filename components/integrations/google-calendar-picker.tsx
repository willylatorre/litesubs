"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	createGoogleBookingCalendar,
	listGoogleCalendars,
	setGoogleCalendars,
} from "@/app/actions/google-calendar";
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
 * Two separate calendar roles.
 *
 * They are deliberately distinct: a creator normally wants their own calendar to
 * BLOCK slots (so existing meetings keep them honest) while bookings are WRITTEN
 * to a dedicated calendar, rather than flooding their personal one.
 *
 * Listing calendars is a network call, so it runs on demand behind a query
 * rather than during page render; a Google failure shows a retry, not a broken
 * page.
 */
export function GoogleCalendarPicker({
	busyCalendarId,
	writeCalendarId,
	writeCalendarCreated,
}: {
	busyCalendarId: string;
	writeCalendarId: string;
	writeCalendarCreated: boolean;
}) {
	const [pending, startTransition] = useTransition();
	const [busy, setBusy] = useState(busyCalendarId);
	const [write, setWrite] = useState(writeCalendarId);
	const [newCalendarName, setNewCalendarName] = useState("Litesubs bookings");
	const [creating, setCreating] = useState(false);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: ["google-calendars"],
		queryFn: async () => {
			const res = await listGoogleCalendars();
			if (!res.success)
				throw new Error(res.error ?? "Could not load calendars");
			return res.data ?? [];
		},
		retry: false,
		staleTime: 60_000,
	});

	const calendars = data ?? [];
	const label = (id: string) => {
		const match = calendars.find((calendar) => calendar.id === id);
		if (!match) return id === "primary" ? "Your main calendar" : id;
		return match.primary ? `${match.summary} (main)` : match.summary;
	};

	function save() {
		startTransition(async () => {
			const result = await setGoogleCalendars({
				busyCalendarId: busy,
				writeCalendarId: write,
			});
			if (!result.success) {
				toast.error(result.error ?? "Could not save calendar choice");
				return;
			}
			toast.success("Calendar settings saved");
		});
	}

	function createCalendar() {
		setCreating(true);
		startTransition(async () => {
			const result = await createGoogleBookingCalendar(newCalendarName);
			setCreating(false);
			if (!result.success) {
				toast.error(result.error ?? "Could not create a calendar");
				return;
			}
			toast.success(
				`Created "${result.data?.summary}" and set it for bookings`,
			);
			if (result.data?.id) setWrite(result.data.id);
			await refetch();
		});
	}

	if (isLoading) {
		return (
			<div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
				Loading your calendars…
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
				<p>
					{error instanceof Error ? error.message : "Could not load calendars"}
				</p>
				<Button
					variant="outline"
					size="sm"
					className="w-fit"
					onClick={() => refetch()}
				>
					Try again
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="grid gap-2">
				<Label htmlFor="google-busy-calendar">Block slots from</Label>
				<Select value={busy} onValueChange={setBusy}>
					<SelectTrigger id="google-busy-calendar">
						<SelectValue placeholder="Choose a calendar" />
					</SelectTrigger>
					<SelectContent>
						{calendars.map((calendar) => (
							<SelectItem key={calendar.id} value={calendar.id}>
								{calendar.primary
									? `${calendar.summary} (main)`
									: calendar.summary}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					Busy events on this calendar remove bookable slots. Only free/busy is
					read — event titles and attendees are never fetched.
				</p>
			</div>

			<div className="grid gap-2">
				<Label htmlFor="google-write-calendar">Write bookings to</Label>
				<Select value={write} onValueChange={setWrite}>
					<SelectTrigger id="google-write-calendar">
						<SelectValue placeholder="Choose a calendar" />
					</SelectTrigger>
					<SelectContent>
						{calendars.map((calendar) => (
							<SelectItem
								key={calendar.id}
								value={calendar.id}
								disabled={!calendar.canWrite}
							>
								{calendar.primary
									? `${calendar.summary} (main)`
									: calendar.summary}
								{calendar.canWrite ? "" : " — read-only"}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					Each confirmed booking creates an event here, and cancelling removes
					it.
					{writeCalendarCreated
						? " Litesubs created this calendar for you."
						: ""}
				</p>
			</div>

			<Button
				size="sm"
				className="w-fit"
				disabled={
					pending || (busy === busyCalendarId && write === writeCalendarId)
				}
				onClick={save}
			>
				{pending ? "Saving…" : "Save calendars"}
			</Button>

			<div className="flex flex-col gap-2 border-t pt-3">
				<Label htmlFor="google-new-calendar">
					Or create a calendar for bookings
				</Label>
				<div className="flex flex-wrap gap-2">
					<Input
						id="google-new-calendar"
						value={newCalendarName}
						onChange={(event) => setNewCalendarName(event.target.value)}
						placeholder="Litesubs bookings"
						className="max-w-xs"
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={pending || creating || !newCalendarName.trim()}
						onClick={createCalendar}
					>
						{creating ? "Creating…" : "Create and use it"}
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					Keeps bookings out of your personal calendar. Current write target:{" "}
					<span className="text-foreground">{label(write)}</span>.
				</p>
			</div>
		</div>
	);
}
