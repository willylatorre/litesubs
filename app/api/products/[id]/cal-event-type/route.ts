import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/app/db";
import { calcomIntegrations, integrations, products } from "@/app/db/schema";
import { auth } from "@/lib/auth";

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;

	const product = await db.query.products.findFirst({
		where: eq(products.id, id),
		with: {
			integration: true,
		},
	});

	if (!product || product.creatorId !== session.user.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const body = await request.json();
		const {
			calEventTypeId,
			calEventTypeSlug,
			calEventTypeName,
			calEventTypeUrl,
		} = body;

		const hasEventType = Number.isInteger(calEventTypeId);

		if (!hasEventType) {
			if (product.integrationId) {
				await db
					.update(products)
					.set({ integrationId: null })
					.where(eq(products.id, id));

				await db.delete(integrations).where(eq(integrations.id, product.integrationId));
			}

			const clearedProduct = await db.query.products.findFirst({
				where: eq(products.id, id),
			});
			return NextResponse.json(clearedProduct);
		}

		if (product.integrationId) {
			const integration = await db.query.integrations.findFirst({
				where: eq(integrations.id, product.integrationId),
			});

			if (integration?.calcomIntegrationId) {
				await db
					.update(calcomIntegrations)
					.set({
						eventTypeId: calEventTypeId,
						eventTypeSlug: calEventTypeSlug,
						eventTypeName: calEventTypeName,
						eventTypeUrl: calEventTypeUrl,
						connectedAt: new Date(),
					})
					.where(eq(calcomIntegrations.id, integration.calcomIntegrationId));
			} else {
				const [calcomIntegration] = await db
					.insert(calcomIntegrations)
					.values({
						eventTypeId: calEventTypeId,
						eventTypeSlug: calEventTypeSlug,
						eventTypeName: calEventTypeName,
						eventTypeUrl: calEventTypeUrl,
						connectedAt: new Date(),
					})
					.returning();

				await db
					.update(integrations)
					.set({
						type: "calcom",
						calcomIntegrationId: calcomIntegration.id,
					})
					.where(eq(integrations.id, product.integrationId));
			}

			const updatedProduct = await db.query.products.findFirst({
				where: eq(products.id, id),
			});
			return NextResponse.json(updatedProduct);
		}

		const [calcomIntegration] = await db
			.insert(calcomIntegrations)
			.values({
				eventTypeId: calEventTypeId,
				eventTypeSlug: calEventTypeSlug,
				eventTypeName: calEventTypeName,
				eventTypeUrl: calEventTypeUrl,
				connectedAt: new Date(),
			})
			.returning();

		const [integration] = await db
			.insert(integrations)
			.values({
				userId: session.user.id,
				type: "calcom",
				calcomIntegrationId: calcomIntegration.id,
			})
			.returning();

		const [updatedProduct] = await db
			.update(products)
			.set({ integrationId: integration.id })
			.where(eq(products.id, id))
			.returning();

		return NextResponse.json(updatedProduct);
	} catch (error) {
		console.error("Failed to update cal.com event type:", error);
		return NextResponse.json(
			{ error: "Failed to update cal.com event type" },
			{ status: 500 },
		);
	}
}
