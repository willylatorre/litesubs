import { z } from "zod";
import { CURRENCIES } from "@/lib/constants";

export const createProductSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	price: z.coerce.number().min(0, "Price must be positive"),
	credits: z.coerce.number().int().min(1, "Credits must be at least 1"),
	currency: z.enum(CURRENCIES).default("usd"),
});

export const createInviteSchema = z.object({
	email: z.string().email().optional().or(z.literal("")),
	productId: z.string().optional(),
});
