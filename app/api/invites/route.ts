import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/app/db";
import { invites } from "@/app/db/schema";
import { auth } from "@/lib/auth";
import { createInviteSchema } from "@/lib/schemas";

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const data = await db.query.invites.findMany({
		where: eq(invites.creatorId, session.user.id),
		with: {
			product: true,
		},
		orderBy: (invites, { desc }) => [desc(invites.createdAt)],
	});

	return NextResponse.json(data);
}

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	try {
		const body = await req.json();
		const validated = createInviteSchema.safeParse(body);

		if (!validated.success) {
			return NextResponse.json({ error: "Invalid email" }, { status: 400 });
		}

		const email = validated.data.email || null;

		if (email) {
			const existingInvite = await db.query.invites.findFirst({
				where: and(
					eq(invites.creatorId, session.user.id),
					eq(invites.email, email),
					eq(invites.status, "pending"),
				),
			});

			if (existingInvite) {
				return NextResponse.json(
					{ error: "Pending invite already exists for this email." },
					{ status: 409 },
				);
			}
		}

		const token = crypto.randomUUID();

		const [newInvite] = await db
			.insert(invites)
			.values({
				creatorId: session.user.id,
				email,
				token,
				status: "pending",
				productId: validated.data.productId,
			})
			.returning();

		return NextResponse.json(newInvite, { status: 201 });
	} catch (error) {
		console.error("Failed to create invite:", error);
		return NextResponse.json(
			{ error: "Failed to create invite" },
			{ status: 500 },
		);
	}
}
