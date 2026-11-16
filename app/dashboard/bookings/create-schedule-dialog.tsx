"use client";

import { IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { getGoogleScheduleTimeZone } from "@/app/actions/google-calendar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSchedule } from "@/hooks/use-booking-schedules";
import {
	isValidTimeZone,
	slugify,
	timeZoneSuggestions,
} from "@/lib/booking-time";

function detectedTimeZone() {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return isValidTimeZone(zone) ? zone : "UTC";
}

/**
 * Create the schedule shell. Availability follows in the editor, so a creator can
 * name the offer first and paint windows second without losing the draft.
 */
export function CreateScheduleDialog({
	creatorUsername,
}: {
	creatorUsername: string | null;
}) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugEdited, setSlugEdited] = useState(false);
	const [timezone, setTimezone] = useState("UTC");
	const [timezoneEdited, setTimezoneEdited] = useState(false);
	const { mutateAsync, isPending } = useCreateSchedule();
	const zones = timeZoneSuggestions();

	// Start with the browser's zone, then prefer Google when the dialog opens.
	// A provider failure never blocks schedule creation or discards a manual edit.
	useEffect(() => {
		if (timezoneEdited) return;
		setTimezone(detectedTimeZone());
		if (!open) return;

		let cancelled = false;
		void getGoogleScheduleTimeZone().then((result) => {
			if (!cancelled && result.success && result.data) {
				setTimezone(result.data);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [open, timezoneEdited]);

	function changeName(value: string) {
		setName(value);
		if (!slugEdited) setSlug(slugify(value));
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		if (!isValidTimeZone(timezone)) {
			return;
		}
		try {
			await mutateAsync({
				name,
				slug,
				description: (form.get("description") as string) || null,
				durationMinutes: Number(form.get("durationMinutes")),
				bufferBeforeMinutes: Number(form.get("bufferBeforeMinutes")),
				bufferAfterMinutes: Number(form.get("bufferAfterMinutes")),
				horizonDays: Number(form.get("horizonDays")),
				timezone,
				active: true,
			});
			setOpen(false);
			setName("");
			setSlug("");
			setSlugEdited(false);
			setTimezone(detectedTimeZone());
			setTimezoneEdited(false);
		} catch {
			// The mutation already surfaced the reason as a toast.
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<IconPlus className="size-4" />
					New schedule
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
				<form onSubmit={onSubmit}>
					<DialogHeader>
						<DialogTitle>New booking schedule</DialogTitle>
						<DialogDescription>
							A schedule is a bookable offer: how long a booking lasts and when
							you accept one. Credits per booking arrive with the plan link.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="schedule-name">Name</Label>
							<Input
								id="schedule-name"
								value={name}
								onChange={(event) => changeName(event.target.value)}
								placeholder="e.g. Weekly office hours"
								required
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="schedule-slug">Public link</Label>
							<Input
								id="schedule-slug"
								value={slug}
								onChange={(event) => {
									setSlugEdited(true);
									setSlug(slugify(event.target.value));
								}}
								placeholder="weekly-office-hours"
								required
							/>
							<p className="text-xs text-muted-foreground">
								Clients will find this schedule at{" "}
								<span className="font-mono">
									/book/{creatorUsername ?? "username"}/{slug || "…"}
								</span>
							</p>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="schedule-description">Description</Label>
							<Textarea
								id="schedule-description"
								name="description"
								placeholder="Optional: what a booking is for"
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="schedule-duration">Duration (min)</Label>
								<Input
									id="schedule-duration"
									name="durationMinutes"
									type="number"
									min={5}
									step={5}
									defaultValue={30}
									required
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="schedule-horizon">Book ahead (days)</Label>
								<Input
									id="schedule-horizon"
									name="horizonDays"
									type="number"
									min={1}
									step={1}
									defaultValue={1}
									required
								/>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="schedule-buffer-before">
									Buffer before (min)
								</Label>
								<Input
									id="schedule-buffer-before"
									name="bufferBeforeMinutes"
									type="number"
									min={0}
									step={5}
									defaultValue={0}
									required
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="schedule-buffer-after">
									Buffer after (min)
								</Label>
								<Input
									id="schedule-buffer-after"
									name="bufferAfterMinutes"
									type="number"
									min={0}
									step={5}
									defaultValue={10}
									required
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="schedule-timezone">Timezone</Label>
							<Input
								id="schedule-timezone"
								list="schedule-timezone-options"
								value={timezone}
								onChange={(event) => {
									setTimezoneEdited(true);
									setTimezone(event.target.value);
								}}
								placeholder="America/New_York"
								required
							/>
							<datalist id="schedule-timezone-options">
								{zones.map((zone) => (
									<option key={zone} value={zone} />
								))}
							</datalist>
							{!isValidTimeZone(timezone) ? (
								<p className="text-xs text-destructive">
									Enter a real IANA timezone, for example{" "}
									<span className="font-mono">America/New_York</span>.
								</p>
							) : (
								<p className="text-xs text-muted-foreground">
									Weekly hours are read in this zone. Bookings keep their exact
									UTC time if you change it later.
								</p>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={isPending || !isValidTimeZone(timezone)}
						>
							{isPending ? "Creating…" : "Create schedule"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
