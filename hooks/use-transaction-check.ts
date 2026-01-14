"use client";

import { startTransition, useEffect, useRef } from "react";
import { toast } from "sonner";
import { checkTransactionStatus } from "@/app/actions/transactions";

interface UseTransactionCheckProps {
	onSuccess?: () => void;
}

export function useTransactionCheck({ onSuccess }: UseTransactionCheckProps = {}) {
	const pollingRef = useRef<NodeJS.Timeout | null>(null);
	// Use ref for onSuccess to avoid effect re-runs when callback changes
	const onSuccessRef = useRef(onSuccess);
	onSuccessRef.current = onSuccess;

	useEffect(() => {
		// Read params on-demand inside effect to avoid subscribing to all URL changes
		const params = new URLSearchParams(window.location.search);
		const success = params.get("success");
		const purchasedProductId = params.get("productId");

		if (success && purchasedProductId) {
			toast.info("Purchase successful! Your credits are being updated...");

			// Clear URL params
			params.delete("success");
			params.delete("productId");
			const newQueryString = params.toString();
			window.history.replaceState(
				null,
				"",
				newQueryString ? `${window.location.pathname}?${newQueryString}` : window.location.pathname,
			);

			const pollForUpdates = async () => {
				let attempts = 0;
				const maxAttempts = 30; // Poll for 60 seconds max

				const checkCondition = async () => {
					attempts++;
					const result = await checkTransactionStatus(purchasedProductId);

					if (result?.status === "completed") {
						// Use startTransition for non-urgent updates to maintain UI responsiveness
						startTransition(() => {
							if (onSuccessRef.current) {
								onSuccessRef.current();
							}
						});
						toast.success("Credits updated successfully!");
						return true;
					}

					if (attempts >= maxAttempts) {
						toast.error(
							"It's taking longer than expected. Please refresh the page in a moment.",
						);
						return true;
					}

					return false;
				};

				const runPoll = async () => {
					const shouldStop = await checkCondition();
					if (!shouldStop) {
						pollingRef.current = setTimeout(runPoll, 2000);
					}
				};

				runPoll();
			};

			pollForUpdates();

			return () => {
				if (pollingRef.current) {
					clearTimeout(pollingRef.current);
				}
			};
		}
	}, []); // Only run once on mount - params are read on-demand inside the effect
}
