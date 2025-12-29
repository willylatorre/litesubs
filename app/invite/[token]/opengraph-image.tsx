import { eq } from "drizzle-orm";
import { ImageResponse } from "next/og";
import { db } from "@/app/db";
import { invites } from "@/app/db/schema";

export const runtime = "nodejs";

export const alt = "LiteSubs Invite";
export const size = {
	width: 1200,
	height: 630,
};

export const contentType = "image/png";

export default async function Image({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;

	const invite = await db.query.invites.findFirst({
		where: eq(invites.token, token),
		with: {
			creator: true,
			product: true,
		},
	});

	if (!invite) {
		return new ImageResponse(
			<div
				style={{
					fontSize: 48,
					background: "white",
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					flexDirection: "column",
				}}
			>
				<div>LiteSubs</div>
				<div style={{ fontSize: 24, marginTop: 20 }}>Invite Not Found</div>
			</div>,
			{
				...size,
			},
		);
	}

	const isProduct = !!invite.product;
	const creatorInitial = invite.creator.name.charAt(0).toUpperCase();

	return new ImageResponse(
		<div
			style={{
				background: "white",
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				fontFamily: "sans-serif",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					border: "1px solid #E5E7EB",
					borderRadius: 24,
					padding: 60,
					boxShadow: "0 10px 30px -10px rgba(0,0,0,0.1)",
					background: "#FAFAFA",
					width: "80%",
					textAlign: "center",
				}}
			>
				{/* Logo / Brand */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						marginBottom: 40,
					}}
				>
					<div style={{ fontSize: 32, fontWeight: 900, color: "#111" }}>
						LiteSubs
					</div>
				</div>

				{/* Creator Info */}
				<div
					style={{ display: "flex", alignItems: "center", marginBottom: 20 }}
				>
					{/* Avatar Placeholder */}
					<div
						style={{
							width: 60,
							height: 60,
							borderRadius: 30,
							background: "#111",
							color: "white",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 24,
							fontWeight: "bold",
							marginRight: 16,
						}}
					>
						{creatorInitial}
					</div>
					<div style={{ fontSize: 24, color: "#666" }}>
						Invite from{" "}
						<span style={{ color: "#111", fontWeight: "bold" }}>
							{invite.creator.name}
						</span>
					</div>
				</div>

				{isProduct && invite.product ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
						}}
					>
						<div
							style={{
								fontSize: 64,
								fontWeight: "bold",
								marginBottom: 10,
								color: "#111",
								lineHeight: 1.1,
							}}
						>
							{invite.product.name}
						</div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								background: "#F3F4F6",
								borderRadius: 100,
								padding: "12px 32px",
								marginTop: 20,
							}}
						>
							<div style={{ fontSize: 32, fontWeight: "bold", color: "#111" }}>
								{invite.product.credits} Credits
							</div>
							<div
								style={{
									width: 8,
									height: 8,
									borderRadius: 4,
									background: "#D1D5DB",
									margin: "0 16px",
								}}
							/>
							<div style={{ fontSize: 32, color: "#4B5563" }}>
								{new Intl.NumberFormat("en-US", {
									style: "currency",
									currency: invite.product.currency,
								}).format(invite.product.price / 100)}
							</div>
						</div>
					</div>
				) : (
					<div
						style={{
							fontSize: 48,
							fontWeight: "bold",
							marginTop: 20,
							color: "#111",
						}}
					>
						Connect on LiteSubs
					</div>
				)}
			</div>
		</div>,
		{
			...size,
		},
	);
}
