"use client";

import { IconCalendarEvent } from "@tabler/icons-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatMinutes, weekdayName } from "@/lib/booking-time";
import type { ScheduleView } from "@/lib/booking-types";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { CreateScheduleDialog } from "./create-schedule-dialog";
import { ExceptionsEditor } from "./exceptions-editor";
import { ScheduleSettingsForm } from "./schedule-settings-form";
import { WeeklyHoursEditor } from "./weekly-hours-editor";

/** A compact "Mon–Fri 09:00–12:00" summary for the schedule picker. */
function summarize(schedule: ScheduleView) {
	if (schedule.availability.length === 0) return "No hours set";
	const byDay = new Map<number, string[]>();
	for (const window of schedule.availability) {
		const label = `${formatMinutes(window.startMinute)}–${formatMinutes(window.endMinute)}`;
		byDay.set(window.weekday, [...(byDay.get(window.weekday) ?? []), label]);
	}
	return [...byDay.entries()]
		.sort(([a], [b]) => a - b)
		.map(
			([weekday, windows]) =>
				`${weekdayName(weekday).slice(0, 3)} ${windows.join(", ")}`,
		)
		.join(" · ");
}

export function BookingsEditor({
	initialSchedules,
}: {
	initialSchedules: ScheduleView[];
}) {
	const [selectedId, setSelectedId] = useState(initialSchedules[0]?.id ?? null);
	// A save re-renders with fresh server data; keep the creator's selection.
	const schedule =
		initialSchedules.find((item) => item.id === selectedId) ??
		initialSchedules[0] ??
		null;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
					<p className="text-muted-foreground text-sm">
						Say when you are bookable, without touching a calendar. Weekly hours
						define your normal week; one-off blocks carve out exceptions.
					</p>
				</div>
				<CreateScheduleDialog />
			</div>

			{initialSchedules.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center gap-3 py-12 text-center">
						<span className="flex size-10 items-center justify-center rounded-lg bg-muted">
							<IconCalendarEvent className="size-5" />
						</span>
						<p className="text-sm text-muted-foreground">
							No booking schedules yet. Create one to publish the hours when
							clients can book you.
						</p>
						<CreateScheduleDialog />
					</CardContent>
				</Card>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<Select
							value={schedule?.id}
							onValueChange={(value) => setSelectedId(value)}
						>
							<SelectTrigger className="w-[min(100%,22rem)]" size="sm">
								<SelectValue placeholder="Choose a schedule" />
							</SelectTrigger>
							<SelectContent>
								{initialSchedules.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										{item.name}
										{item.isSample ? " (sample)" : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{schedule ? (
							<>
								<Badge variant="outline" className="font-mono">
									{schedule.timezone}
								</Badge>
								{schedule.active ? (
									<Badge variant="default">Accepting bookings</Badge>
								) : (
									<Badge variant="secondary">Paused</Badge>
								)}
								{schedule.isSample ? (
									<Badge variant="outline">Sample</Badge>
								) : null}
							</>
						) : null}
					</div>

					{schedule ? (
						<>
							<p className="text-sm text-muted-foreground">
								{summarize(schedule)}
							</p>
							{schedule.isSample ? (
								<p className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
									This is the sample schedule, so it stays exactly as loaded and
									real edits cannot change it. Create your own schedule to start
									editing.
								</p>
							) : null}

							<Card>
								<CardHeader>
									<CardTitle className="text-base">Availability</CardTitle>
									<CardDescription>
										Windows are wall-clock times in {schedule.timezone}.
									</CardDescription>
								</CardHeader>
								<CardContent>
									<WeeklyHoursEditor
										key={`${schedule.id}-hours`}
										schedule={schedule}
									/>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-base">Settings</CardTitle>
									<CardDescription>
										Duration, buffers, horizon, and whether the schedule is
										live.
									</CardDescription>
								</CardHeader>
								<CardContent>
									<ScheduleSettingsForm
										key={`${schedule.id}-settings`}
										schedule={schedule}
									/>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-base">Exceptions</CardTitle>
									<CardDescription>
										Block a day or an hour. Blocks always win over weekly hours.
									</CardDescription>
								</CardHeader>
								<CardContent>
									<ExceptionsEditor
										key={`${schedule.id}-exceptions`}
										schedule={schedule}
									/>
								</CardContent>
							</Card>
						</>
					) : null}
				</>
			)}
		</div>
	);
}
