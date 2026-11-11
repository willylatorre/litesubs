import { z } from "zod";
import { ServiceError } from "@/lib/services/principal";

export function errorResponse(error: unknown) {
	if (error instanceof ServiceError)
		return Response.json(
			{ error: error.message, code: error.code, details: error.details },
			{ status: error.status },
		);
	if (error instanceof z.ZodError)
		return Response.json(
			{
				error: "Invalid input",
				code: "INVALID_INPUT",
				fieldErrors: error.flatten().fieldErrors,
			},
			{ status: 400 },
		);
	if (error instanceof SyntaxError)
		return Response.json(
			{ error: "Invalid JSON", code: "INVALID_INPUT" },
			{ status: 400 },
		);
	console.error("API request failed", error);
	return Response.json(
		{ error: "Request failed", code: "INTERNAL_ERROR" },
		{ status: 500 },
	);
}
