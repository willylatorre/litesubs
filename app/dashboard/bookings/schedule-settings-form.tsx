"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSaveScheduleSettings } from "@/hooks/use-booking-schedules";
import { isValidTimeZone, timeZoneSuggestions } from "@/lib/booking-time";
import type { ScheduleView } from "@/lib/booking-types";

/**
 * Duration, buffers, horizon, timezone and on/off. Availability and blocks are
 * separate saves so editing one never rewrites the other.
 */
export function ScheduleSettingsForm({ schedule }: { schedule: ScheduleView }) {
	const zones = timeZoneSuggestions();
	const [timezone, setTimezone] = useState(schedule.timezone);
	const [active, setActive] = useState(schedule.active);
	const [slug, setSlug] = useState(schedule.slug);
	const { mutateAsync, isPending } = useSaveScheduleSettings();
	const readOnly = schedule.isSample;

	// Switching schedules remounts this form (the parent keys it by ID), so the
	// effect only needs to track the values that a refresh can change.
	useEffect(() => {
		setTimezone(schedule.timezone);
		setActive(schedule.active);
		setSlug(schedule.slug);
	}, [schedule.timezone, schedule.active, schedule.slug]);

	const timezoneValid = isValidTimeZone(timezone);
	const timezoneChanged = timezone !== schedule.timezone;

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!timezoneValid) return;
		const form = new FormData(event.currentTarget);
		try {
			await mutateAsync({
				identifier: schedule.id,
				name: (form.get("name") as string) || schedule.name,
				slug,
				description: (form.get("description") as string) || null,
				durationMinutes: Number(form.get("durationMinutes")),
				bufferBeforeMinutes: Number(form.get("bufferBeforeMinutes")),
				bufferAfterMinutes: Number(form.get("bufferAfterMinutes")),
				horizonDays: Number(form.get("horizonDays")),
				timezone,
				active,
			});
		} catch {
			// The mutation already showed the server's message as a toast.
		}
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold">Schedule settings</h2>
					<p className="text-sm text-muted-foreground">
						How long a booking lasts, how much breathing room it needs, and how
						far ahead it may be booked.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						id="schedule-active"
						checked={active}
						onCheckedChange={setActive}
						disabled={readOnly}
					/>
					<Label htmlFor="schedule-active" className="text-sm">
						{active ? "Accepting bookings" : "Paused"}
					</Label>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="grid gap-2">
					<Label htmlFor="settings-name">Name</Label>
					<Input
						id="settings-name"
						name="name"
						defaultValue={schedule.name}
						disabled={readOnly}
						required
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="settings-slug">Public link</Label>
					<Input
						id="settings-slug"
						value={slug}
						onChange={(event) => setSlug(event.target.value)}
						disabled={readOnly}
						required
					/>
					<p className="text-xs text-muted-foreground font-mono">
						/book/{slug || "…"}
					</p>
				</div>
			</div>

			<div className="grid gap-2">
				<Label htmlFor="settings-description">Description</Label>
				<Textarea
					id="settings-description"
					name="description"
					defaultValue={schedule.description ?? ""}
					disabled={readOnly}
				/>
			</div>

			<div className="grid gap-4 sm:grid-cols-4">
				<div className="grid gap-2">
					<Label htmlFor="settings-duration">Duration (min)</Label>
					<Input
						id="settings-duration"
						name="durationMinutes"
						type="number"
						min={1}
						step={5}
						defaultValue={schedule.durationMinutes}
						disabled={readOnly}
						required
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="settings-buffer-before">Buffer before</Label>
					<Input
						id="settings-buffer-before"
						name="bufferBeforeMinutes"
						type="number"
						min={0}
						step={5}
						defaultValue={schedule.bufferBeforeMinutes}
						disabled={readOnly}
						required
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="settings-buffer-after">Buffer after</Label>
					<Input
						id="settings-buffer-after"
						name="bufferAfterMinutes"
						type="number"
						min={0}
						step={5}
						defaultValue={schedule.bufferAfterMinutes}
						disabled={readOnly}
						required
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="settings-horizon">Book ahead (days)</Label>
					<Input
						id="settings-horizon"
						name="horizonDays"
						type="number"
						min={1}
						step={1}
						defaultValue={schedule.horizonDays}
						disabled={readOnly}
						required
					/>
				</div>
			</div>

			<div className="grid gap-2">
				<Label htmlFor="settings-timezone">Timezone</Label>
				<Input
					id="settings-timezone"
					list="settings-timezone-options"
					value={timezone}
					onChange={(event) => setTimezone(event.target.value)}
					disabled={readOnly}
					required
				/>
				<datalist id="settings-timezone-options">
					{zones.map((zone) => (
						<option key={zone} value={zone} />
					))}
				</datalist>
				{!timezoneValid ? (
					<p className="text-xs text-destructive">
						Enter a real IANA timezone, for example{" "}
						<span className="font-mono">America/New_York</span>.
					</p>
				) : timezoneChanged ? (
					<p className="text-xs text-muted-foreground">
						Weekly hours stay at the same wall-clock times, so they move to a
						new UTC instant. Bookings already made keep their original time.
					</p>
				) : (
					<p className="text-xs text-muted-foreground">
						Weekly hours are read in this zone.
					</p>
				)}
			</div>

			<div className="flex items-center gap-2">
				<Button
					type="submit"
					disabled={isPending || readOnly || !timezoneValid}
				>
					{isPending ? (
						"Saving…"
					) : (
						<>
							<Check className="size-4" />
							Save settings
						</>
					)}
				</Button>
				{readOnly ? (
					<p className="text-xs text-muted-foreground">
						<X className="mr-1 inline size-3" />
						Sample schedules are read-only.
					</p>
				) : null}
			</div>
		</form>
	);
}
