"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { checkTransactionStatus } from "@/app/actions/transactions";

interface UseTransactionCheckProps {
	onSuccess?: () => void;
}

export function useTransactionCheck({ onSuccess }: UseTransactionCheckProps = {}) {
	const searchParams = useSearchParams();
	const pollingRef = useRef<NodeJS.Timeout | null>(null);

	const success = searchParams.get("success");
	const purchasedProductId = searchParams.get("productId");

	useEffect(() => {
		if (success && purchasedProductId) {
			toast.info("Purchase successful! Your credits are being updated...");

			// Clear URL params
			const newSearchParams = new URLSearchParams(searchParams.toString());
			newSearchParams.delete("success");
			newSearchParams.delete("productId");
			window.history.replaceState(
				null,
				"",
				`${window.location.pathname}?${newSearchParams.toString()}`,
			);

			const pollForUpdates = async () => {
				let attempts = 0;
				const maxAttempts = 30; // Poll for 60 seconds max

				const checkCondition = async () => {
					attempts++;
					const result = await checkTransactionStatus(purchasedProductId);

					if (result?.status === "completed") {
						if (onSuccess) await onSuccess();
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
	}, [success, purchasedProductId, searchParams, onSuccess]);
}
