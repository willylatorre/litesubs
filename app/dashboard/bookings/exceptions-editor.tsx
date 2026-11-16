"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveExceptions } from "@/hooks/use-booking-schedules";
import {
	formatInZone,
	zonedInputValueToUtc,
	utcToZonedInputValue,
} from "@/lib/booking-time";
import type { ExceptionPayload, ScheduleView } from "@/lib/booking-types";

type DraftException = {
	key: string;
	startsAt: string;
	endsAt: string;
	reason: string;
};

let exceptionKey = 0;
function nextKey() {
	exceptionKey += 1;
	return `exception-${exceptionKey}`;
}

/**
 * One-off blocks (holidays, travel). They are entered as wall-clock times in the
 * schedule's zone for clarity, then stored as UTC instants so blocking a day is
 * independent of any later timezone change.
 */
export function ExceptionsEditor({ schedule }: { schedule: ScheduleView }) {
	const [drafts, setDrafts] = useState<DraftException[]>(() =>
		schedule.exceptions.map((exception) => ({
			key: nextKey(),
			startsAt: utcToZonedInputValue(exception.startsAt, schedule.timezone),
			endsAt: utcToZonedInputValue(exception.endsAt, schedule.timezone),
			reason: exception.reason ?? "",
		})),
	);
	const [error, setError] = useState<string | null>(null);
	const { mutateAsync, isPending } = useSaveExceptions();
	const readOnly = schedule.isSample;

	function addDraft() {
		// Default to tomorrow 09:00–17:00 in the schedule's zone, so the form
		// already holds a plausible block instead of an empty range.
		const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const start = new Date(
			Date.UTC(
				tomorrow.getUTCFullYear(),
				tomorrow.getUTCMonth(),
				tomorrow.getUTCDate(),
				9,
			),
		);
		const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
		setDrafts((current) => [
			...current,
			{
				key: nextKey(),
				startsAt: utcToZonedInputValue(start, schedule.timezone),
				endsAt: utcToZonedInputValue(end, schedule.timezone),
				reason: "",
			},
		]);
	}

	function update(key: string, patch: Partial<DraftException>) {
		setDrafts((current) =>
			current.map((draft) =>
				draft.key === key ? { ...draft, ...patch } : draft,
			),
		);
	}

	async function save() {
		setError(null);
		const payload: ExceptionPayload[] = [];
		for (const draft of drafts) {
			const startsAt = zonedInputValueToUtc(draft.startsAt, schedule.timezone);
			const endsAt = zonedInputValueToUtc(draft.endsAt, schedule.timezone);
			if (!startsAt || !endsAt) {
				setError("Every block needs a start and an end.");
				return;
			}
			if (endsAt.getTime() <= startsAt.getTime()) {
				setError("A block must end after it starts.");
				return;
			}
			payload.push({
				startsAt: startsAt.toISOString(),
				endsAt: endsAt.toISOString(),
				reason: draft.reason || null,
			});
		}
		try {
			await mutateAsync({ identifier: schedule.id, exceptions: payload });
		} catch {
			// The mutation already showed the server's message as a toast.
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-base font-semibold">One-off blocks</h2>
				<p className="text-sm text-muted-foreground">
					Holidays, travel, an appointment elsewhere. Times are entered in{" "}
					<span className="font-medium text-foreground">
						{schedule.timezone}
					</span>{" "}
					and saved as exact instants.
				</p>
			</div>

			{drafts.length === 0 ? (
				<p className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
					No blocks. Weekly hours apply every week until you add one.
				</p>
			) : (
				<div className="flex flex-col gap-3">
					{drafts.map((draft) => (
						<div
							key={draft.key}
							className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
						>
							<div className="grid gap-1">
								<Label htmlFor={`block-start-${draft.key}`}>Starts</Label>
								<Input
									id={`block-start-${draft.key}`}
									type="datetime-local"
									value={draft.startsAt}
									disabled={readOnly}
									onChange={(event) =>
										update(draft.key, { startsAt: event.target.value })
									}
								/>
							</div>
							<div className="grid gap-1">
								<Label htmlFor={`block-end-${draft.key}`}>Ends</Label>
								<Input
									id={`block-end-${draft.key}`}
									type="datetime-local"
									value={draft.endsAt}
									disabled={readOnly}
									onChange={(event) =>
										update(draft.key, { endsAt: event.target.value })
									}
								/>
							</div>
							<div className="grid gap-1">
								<Label htmlFor={`block-reason-${draft.key}`}>Reason</Label>
								<Input
									id={`block-reason-${draft.key}`}
									value={draft.reason}
									placeholder="Optional"
									disabled={readOnly}
									onChange={(event) =>
										update(draft.key, { reason: event.target.value })
									}
								/>
							</div>
							<Button
								variant="ghost"
								size="sm"
								disabled={readOnly}
								onClick={() =>
									setDrafts((current) =>
										current.filter((item) => item.key !== draft.key),
									)
								}
							>
								<IconTrash className="size-4" />
								<span className="sr-only">Remove block</span>
							</Button>
						</div>
					))}
				</div>
			)}

			{schedule.exceptions.length > 0 ? (
				<p className="text-xs text-muted-foreground">
					Saved blocks:{" "}
					{schedule.exceptions
						.map(
							(exception) =>
								`${formatInZone(exception.startsAt, schedule.timezone)} → ${formatInZone(exception.endsAt, schedule.timezone)}`,
						)
						.join(" · ")}
				</p>
			) : null}

			{error ? <p className="text-sm text-destructive">{error}</p> : null}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={addDraft}
					disabled={readOnly}
				>
					<IconPlus className="size-4" />
					Add block
				</Button>
				<Button onClick={() => void save()} disabled={isPending || readOnly}>
					{isPending ? "Saving…" : "Save blocks"}
				</Button>
				{readOnly ? (
					<p className="text-xs text-muted-foreground">
						Sample schedules are read-only.
					</p>
				) : null}
			</div>
		</div>
	);
}
