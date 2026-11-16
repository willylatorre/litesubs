import { getCurrentSession } from "@/lib/auth-cached";
import { listSchedules } from "@/lib/services/booking-schedules";
import { sessionPrincipal } from "@/lib/services/principal";
import { BookingsEditor } from "./bookings-editor";
import { MyBookings } from "./my-bookings";

export const dynamic = "force-dynamic";

/**
 * Bookings hub.
 *
 * Serves both roles: a creator manages schedules here, and either party sees
 * their own bookings. Reading through the service means ownership and scopes are
 * enforced exactly as on every other transport, and `MyBookings` scopes itself
 * to the session, so rendering it for a creator who has booked someone else is
 * correct rather than a leak.
 */
export default async function BookingsPage() {
	const session = await getCurrentSession();
	if (!session?.user) {
		return (
			<div className="p-6 text-sm text-muted-foreground">
				Sign in to see your bookings and manage your schedules.
			</div>
		);
	}

	const schedules = await listSchedules(sessionPrincipal(session.user.id), {
		limit: 100,
	});

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
				<p className="text-sm text-muted-foreground">
					Your sessions, and the schedules you offer.
				</p>
			</div>

			<MyBookings />

			<BookingsEditor initialSchedules={schedules} />
		</div>
	);
}
