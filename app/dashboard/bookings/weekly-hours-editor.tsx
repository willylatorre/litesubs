"use client";

import { IconAlertTriangle, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveAvailability } from "@/hooks/use-booking-schedules";
import {
	findOverlappingWindows,
	formatMinutes,
	parseTimeToMinutes,
	WEEKDAYS,
	weekdayName,
	type WeeklyWindow,
} from "@/lib/booking-time";
import type { ScheduleView } from "@/lib/booking-types";

type DraftWindow = WeeklyWindow & { key: string };

let windowKey = 0;
function nextKey() {
	windowKey += 1;
	return `window-${windowKey}`;
}

/** Existing rows in the schedule's own zone, so the editor never shows UTC. */
function toDraft(schedule: ScheduleView): DraftWindow[] {
	return schedule.availability.map((window) => ({
		key: nextKey(),
		weekday: window.weekday,
		startMinute: window.startMinute,
		endMinute: window.endMinute,
	}));
}

function endFromInput(value: string): number | null {
	// A `time` input cannot express 24:00, and "end at midnight" is a normal
	// window. Treat 00:00 as the end of the day; a window starting at 00:00 and
	// ending at 00:00 is still rejected as empty below.
	const minutes = parseTimeToMinutes(value);
	if (minutes === 0) return 1440;
	return minutes;
}

export function WeeklyHoursEditor({ schedule }: { schedule: ScheduleView }) {
	const [windows, setWindows] = useState<DraftWindow[]>(() =>
		toDraft(schedule),
	);
	const [error, setError] = useState<string | null>(null);
	const { mutateAsync, isPending } = useSaveAvailability();
	const readOnly = schedule.isSample;

	const overlap = useMemo(() => findOverlappingWindows(windows), [windows]);

	function addWindow(weekday: number) {
		const sameDay = windows
			.filter((window) => window.weekday === weekday)
			.sort((a, b) => a.startMinute - b.startMinute);
		const last = sameDay[sameDay.length - 1];
		const startMinute = last ? last.endMinute : 9 * 60;
		setWindows((current) => [
			...current,
			{
				key: nextKey(),
				weekday,
				startMinute: Math.min(startMinute, 1380),
				endMinute: Math.min(startMinute + 60, 1440),
			},
		]);
	}

	function removeWindow(key: string) {
		setWindows((current) => current.filter((window) => window.key !== key));
	}

	function changeWindow(
		key: string,
		patch: Partial<Pick<DraftWindow, "startMinute" | "endMinute">>,
	) {
		setWindows((current) =>
			current.map((window) =>
				window.key === key ? { ...window, ...patch } : window,
			),
		);
	}

	async function save() {
		setError(null);
		const invalid = windows.find(
			(window) => window.endMinute <= window.startMinute,
		);
		if (invalid) {
			setError(
				`${weekdayName(invalid.weekday)} has a window that ends before it starts.`,
			);
			return;
		}
		if (overlap) {
			setError(
				`${weekdayName(overlap[0].weekday)} has overlapping windows: ${formatMinutes(overlap[0].startMinute)}–${formatMinutes(overlap[0].endMinute)} and ${formatMinutes(overlap[1].startMinute)}–${formatMinutes(overlap[1].endMinute)}.`,
			);
			return;
		}
		try {
			await mutateAsync({
				identifier: schedule.id,
				windows: windows.map(({ weekday, startMinute, endMinute }) => ({
					weekday,
					startMinute,
					endMinute,
				})),
			});
		} catch {
			// The mutation already showed the server's message as a toast.
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 className="text-base font-semibold">Weekly hours</h2>
					<p className="text-sm text-muted-foreground">
						Every window below is in{" "}
						<span className="font-medium text-foreground">
							{schedule.timezone}
						</span>
						, including across daylight-saving changes.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						void mutateAsync({ identifier: schedule.id, windows: [] })
					}
					disabled={isPending || readOnly || windows.length === 0}
				>
					<IconTrash className="size-4" />
					Clear all hours
				</Button>
			</div>

			<div className="flex flex-col divide-y rounded-md border">
				{WEEKDAYS.map((day) => {
					const dayWindows = windows
						.filter((window) => window.weekday === day.value)
						.sort((a, b) => a.startMinute - b.startMinute);
					return (
						<div
							key={day.value}
							className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4"
						>
							<div className="w-24 shrink-0 pt-1 text-sm font-medium">
								{day.long}
							</div>
							<div className="flex flex-1 flex-col gap-2">
								{dayWindows.length === 0 ? (
									<p className="pt-1 text-sm text-muted-foreground">
										Not bookable
									</p>
								) : (
									dayWindows.map((window) => (
										<div key={window.key} className="flex items-center gap-2">
											<Label
												className="sr-only"
												htmlFor={`start-${window.key}`}
											>
												{day.long} start
											</Label>
											<Input
												id={`start-${window.key}`}
												type="time"
												className="w-32"
												value={formatMinutes(window.startMinute)}
												disabled={readOnly}
												onChange={(event) => {
													const minutes = parseTimeToMinutes(
														event.target.value,
													);
													if (minutes !== null)
														changeWindow(window.key, { startMinute: minutes });
												}}
											/>
											<span className="text-muted-foreground">to</span>
											<Label className="sr-only" htmlFor={`end-${window.key}`}>
												{day.long} end
											</Label>
											<Input
												id={`end-${window.key}`}
												type="time"
												className="w-32"
												value={formatMinutes(window.endMinute % 1440)}
												disabled={readOnly}
												onChange={(event) => {
													const minutes = endFromInput(event.target.value);
													if (minutes !== null)
														changeWindow(window.key, { endMinute: minutes });
												}}
											/>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => removeWindow(window.key)}
												disabled={readOnly}
											>
												<IconTrash className="size-4" />
												<span className="sr-only">
													Remove {day.long} window
												</span>
											</Button>
										</div>
									))
								)}
								<Button
									variant="ghost"
									size="sm"
									className="w-fit"
									onClick={() => addWindow(day.value)}
									disabled={readOnly}
								>
									Add window
								</Button>
							</div>
						</div>
					);
				})}
			</div>

			<p className="text-xs text-muted-foreground">
				An end of <span className="font-mono">00:00</span> means midnight, the
				end of that day. Windows on the same day cannot overlap.
			</p>

			{error ? (
				<p className="flex items-center gap-2 text-sm text-destructive">
					<IconAlertTriangle className="size-4" />
					{error}
				</p>
			) : null}

			<div className="flex items-center gap-2">
				<Button onClick={() => void save()} disabled={isPending || readOnly}>
					{isPending ? "Saving…" : "Save weekly hours"}
				</Button>
				{readOnly ? (
					<p className="text-xs text-muted-foreground">
						Sample schedules are read-only. Create your own to edit hours.
					</p>
				) : null}
			</div>
		</div>
	);
}
