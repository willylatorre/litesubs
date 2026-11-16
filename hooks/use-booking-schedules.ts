"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
	createBookingScheduleAction,
	saveBookingAvailabilityAction,
	saveBookingExceptionsAction,
	updateBookingScheduleAction,
} from "@/app/actions/booking-schedules";
import type {
	ExceptionPayload,
	ScheduleSettingsPayload,
	WeeklyWindowPayload,
} from "@/lib/booking-types";

/**
 * Mutations for the bookings editor.
 *
 * The page is a server component that reads schedules, so these hooks only
 * persist a change and then refresh what is on screen.
 */
export function useCreateSchedule() {
	const router = useRouter();
	return useMutation({
		mutationFn: (input: ScheduleSettingsPayload) =>
			createBookingScheduleAction(input).then(requireData),
		onSuccess: () => {
			toast.success("Schedule created");
			router.refresh();
		},
		onError: (error: Error) => toast.error(error.message),
	});
}

export function useSaveScheduleSettings() {
	const queryClient = useQueryClient();
	const router = useRouter();
	return useMutation({
		mutationFn: ({
			identifier,
			...input
		}: ScheduleSettingsPayload & { identifier: string }) =>
			updateBookingScheduleAction(identifier, input).then(requireData),
		onSuccess: () => {
			toast.success("Schedule saved");
			queryClient.invalidateQueries({ queryKey: ["booking-schedules"] });
			router.refresh();
		},
		onError: (error: Error) => toast.error(error.message),
	});
}

export function useSaveAvailability() {
	const router = useRouter();
	return useMutation({
		mutationFn: ({
			identifier,
			windows,
		}: {
			identifier: string;
			windows: WeeklyWindowPayload[];
		}) => saveBookingAvailabilityAction(identifier, windows).then(requireData),
		onSuccess: () => {
			toast.success("Weekly hours saved");
			router.refresh();
		},
		onError: (error: Error) => toast.error(error.message),
	});
}

export function useSaveExceptions() {
	const router = useRouter();
	return useMutation({
		mutationFn: ({
			identifier,
			exceptions,
		}: {
			identifier: string;
			exceptions: ExceptionPayload[];
		}) => saveBookingExceptionsAction(identifier, exceptions).then(requireData),
		onSuccess: () => {
			toast.success("One-off blocks saved");
			router.refresh();
		},
		onError: (error: Error) => toast.error(error.message),
	});
}

/**
 * A server action reports a refusal in `error` rather than throwing, so the
 * mutation must convert it to a rejection or the UI would show a success toast.
 */
function requireData<T>(result: {
	success?: boolean;
	error?: string;
	data?: T;
}): T {
	if (result.error || !result.data)
		throw new Error(result.error ?? "Save failed");
	return result.data;
}
