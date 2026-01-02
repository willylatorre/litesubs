import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Format a number as currency
 * @param amount - Amount in the currency's base unit (e.g., dollars, not cents)
 * @param currency - ISO 4217 currency code (e.g., 'usd', 'eur')
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currency: string = "usd"): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
}
