"use client";

import { Building2, Landmark, User, Wallet } from "lucide-react";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";

/**
 * Where money actually goes on a sale.
 *
 * The geometry is the argument: the customer's payment lands on the creator's
 * own Stripe account, and LiteSubs' fee branches off that same path as a thin
 * slice leaving for the platform. Nothing is routed through a platform balance
 * first — that is the whole reason a creator keeps the full Stripe Dashboard.
 *
 * Built from flat isometric planes rather than a perspective projection: every
 * face is a parallelogram on a 2:1 grid, so the shapes stay crisp at any size
 * and read the same in light and dark. All colour comes from theme tokens, and
 * the drawing is static on purpose — the section owns the reveal, so a missed
 * scroll observer can never leave essential content invisible.
 */

const FEE_PERCENT_LABEL = `${PLATFORM_FEE_PERCENT * 100}%`;

/**
 * One isometric tile on a 2:1 grid. `x`/`y` is the top of the diamond, so the
 * shape spans x..x+w horizontally and y..y+d vertically.
 */
function plane(x: number, y: number, w: number, d: number) {
	const hw = w / 2;
	const hd = d / 2;
	return `M ${x} ${y + hd} L ${x + hw} ${y} L ${x + w} ${y + hd} L ${x + hw} ${y + d} Z`;
}

/** The left (shaded) wall that lifts a plane into a slab. */
function faceLeft(x: number, y: number, w: number, d: number, h: number) {
	const hw = w / 2;
	const hd = d / 2;
	return `M ${x} ${y + hd} L ${x + hw} ${y + d} L ${x + hw} ${y + d + h} L ${x} ${y + hd + h} Z`;
}

/** The right (lighter) wall. Two distinct shades are what make depth legible. */
function faceRight(x: number, y: number, w: number, d: number, h: number) {
	const hw = w / 2;
	const hd = d / 2;
	return `M ${x + w} ${y + hd} L ${x + hw} ${y + d} L ${x + hw} ${y + d + h} L ${x + w} ${y + hd + h} Z`;
}

const W = 190;
const D = 92;
const H = 22;

type SlabProps = {
	x: number;
	y: number;
	label: string;
	Icon: typeof User;
	/** Where the role label sits relative to the slab, clear of both walls. */
	labelAbove?: boolean;
};

function Slab({ x, y, label, Icon, labelAbove }: SlabProps) {
	const cx = x + W / 2;
	const cy = y + D / 2;
	return (
		<g>
			<path
				d={faceLeft(x, y, W, D, H)}
				className="fill-primary/15 stroke-primary/25"
				strokeWidth="1"
				strokeLinejoin="round"
			/>
			<path
				d={faceRight(x, y, W, D, H)}
				className="fill-primary/30 stroke-primary/25"
				strokeWidth="1"
				strokeLinejoin="round"
			/>
			<path
				d={plane(x, y, W, D)}
				className="fill-background stroke-primary/30"
				strokeWidth="1.25"
				strokeLinejoin="round"
			/>
			<Icon
				x={cx - 10}
				y={cy - 10}
				width={20}
				height={20}
				aria-hidden="true"
				strokeWidth={1.5}
				className="text-primary"
			/>
			<text
				x={cx}
				y={labelAbove ? y - 14 : y + D + H + 26}
				textAnchor="middle"
				className="fill-foreground text-[15px] font-semibold"
			>
				{label}
			</text>
		</g>
	);
}

export function StripeConnectDiagram() {
	// Slab centres, shared with the connector paths so nothing can drift apart.
	const moneyY = 210;
	const customer = { cx: 120, cy: moneyY };
	const litesubs = { cx: 360, cy: 96 };
	const creator = { cx: 600, cy: moneyY };
	const slabBottom = moneyY + D / 2 + H;

	return (
		<svg
			viewBox="0 0 720 400"
			role="img"
			aria-labelledby="connect-diagram-title connect-diagram-desc"
			className="w-full"
		>
			<title id="connect-diagram-title">
				How a sale is split under Stripe Connect
			</title>
			<desc id="connect-diagram-desc">
				A customer pays on the creator&apos;s own connected Stripe account. The
				creator keeps the sale minus a {FEE_PERCENT_LABEL} application fee,
				which LiteSubs collects, and Stripe pays the creator out on their own
				schedule.
			</desc>

			{/* The money path: customer straight to the creator's own account. */}
			<path
				d={`M ${customer.cx + W / 2} ${moneyY} L ${creator.cx - W / 2} ${moneyY}`}
				fill="none"
				className="stroke-primary"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>

			{/* The fee leaves that same payment for LiteSubs, which sits above the
			    path. Drawn over the money line so the junction reads as a split. */}
			<path
				d={`M ${litesubs.cx} ${moneyY} L ${litesubs.cx} ${litesubs.cy + D / 2 + H}`}
				fill="none"
				className="stroke-primary/50"
				strokeWidth="2"
				strokeDasharray="4 5"
			/>
			<circle cx={litesubs.cx} cy={moneyY} r={4.5} className="fill-primary" />
			<text
				x={litesubs.cx + 16}
				y={moneyY - 14}
				className="fill-muted-foreground text-[13px]"
			>
				{FEE_PERCENT_LABEL} application fee
			</text>

			{/* Payout leaves the creator's account on the creator's own schedule. */}
			<path
				d={`M ${creator.cx} ${slabBottom + 42} L ${creator.cx} ${slabBottom + 62}`}
				fill="none"
				className="stroke-muted-foreground/50"
				strokeWidth="2"
				strokeDasharray="3 4"
			/>
			<Landmark
				x={creator.cx - 10}
				y={slabBottom + 64}
				width={20}
				height={20}
				aria-hidden="true"
				strokeWidth={1.5}
				className="text-muted-foreground"
			/>
			<text
				x={creator.cx}
				y={slabBottom + 102}
				textAnchor="middle"
				className="fill-muted-foreground text-[13px]"
			>
				paid out on your schedule
			</text>

			<Slab
				x={customer.cx - W / 2}
				y={moneyY - D / 2}
				label="Customer"
				Icon={User}
			/>
			<Slab
				x={litesubs.cx - W / 2}
				y={litesubs.cy - D / 2}
				label="LiteSubs"
				Icon={Building2}
				labelAbove
			/>
			<Slab
				x={creator.cx - W / 2}
				y={moneyY - D / 2}
				label="Your Stripe account"
				Icon={Wallet}
			/>
		</svg>
	);
}
