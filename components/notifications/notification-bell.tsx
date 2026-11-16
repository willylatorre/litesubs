"use client";

import { IconBell, IconChecks } from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
	getNotificationFeed,
	getUnreadNotificationCount,
	markAllNotificationsRead,
	markNotificationsRead,
} from "@/app/actions/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { NotificationView } from "@/lib/services/notifications";
import { cn } from "@/lib/utils";

type Feed = {
	items: NotificationView[];
	startingSoon: NotificationView[];
};

function relativeTime(iso: string) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return formatDistanceToNow(date, { addSuffix: true });
}

function NotificationRow({
	notification,
	/** Unread when the panel was opened; the dot survives the read-on-open. */
	unread,
	onNavigate,
}: {
	notification: NotificationView;
	unread: boolean;
	onNavigate: () => void;
}) {
	const content = (
		<>
			<div className="flex items-start gap-2">
				<span
					aria-hidden
					className={cn(
						"mt-1.5 size-1.5 shrink-0 rounded-full",
						unread
							? "bg-primary"
							: notification.derived
								? "bg-emerald-500"
								: "bg-transparent",
					)}
				/>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<div className="flex items-start justify-between gap-2">
						<span
							className={cn(
								"truncate text-sm",
								unread ? "font-medium" : "text-foreground/90",
							)}
						>
							{notification.title}
						</span>
						{notification.derived && (
							<Badge variant="secondary" className="shrink-0">
								Soon
							</Badge>
						)}
					</div>
					{notification.body && (
						<span className="text-muted-foreground line-clamp-2 text-xs">
							{notification.body}
						</span>
					)}
					<span className="text-muted-foreground text-xs">
						{notification.derived && notification.startsAt
							? `Starts ${relativeTime(notification.startsAt)}`
							: relativeTime(notification.createdAt)}
					</span>
				</div>
			</div>
		</>
	);

	const className =
		"block rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/60";

	if (!notification.href) {
		return <div className={className}>{content}</div>;
	}

	return (
		<Link href={notification.href} className={className} onClick={onNavigate}>
			{content}
		</Link>
	);
}

/**
 * In-app notification bell.
 *
 * No email, no scheduler: the list is the persisted feed plus "starting soon"
 * items that the server derives from booking times each time this panel opens.
 * Opening the panel marks the persisted unread items read; "starting soon" is
 * derived and therefore never marked.
 */
export function NotificationBell() {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [markingAll, setMarkingAll] = useState(false);
	const [feed, setFeed] = useState<Feed>({ items: [], startingSoon: [] });
	const [unread, setUnread] = useState(0);
	const [unreadOnOpen, setUnreadOnOpen] = useState<Set<string>>(new Set());

	// Badge cost stays one small count query per page load; the panel itself is
	// only fetched when it is opened.
	useEffect(() => {
		let cancelled = false;
		getUnreadNotificationCount()
			.then((result) => {
				if (!cancelled && result.success) setUnread(result.data ?? 0);
			})
			.catch(() => {
				// A bell failure must never surface as a page error.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const loadFeed = useCallback(async () => {
		setLoading(true);
		try {
			const result = await getNotificationFeed();
			if (!result.success || !result.data) return;

			const { items, startingSoon, unreadCount } = result.data;
			const stillUnread = new Set(
				items.filter((item) => !item.readAt).map((item) => item.id),
			);
			setFeed({ items, startingSoon });
			setUnreadOnOpen(stillUnread);
			setUnread(unreadCount);

			// Read-on-open: once the user has seen the list, the persisted items are
			// read. The dot for this session is kept from the snapshot above.
			if (stillUnread.size > 0) {
				const marked = await markNotificationsRead([...stillUnread]);
				if (marked.success) setUnread(0);
			}
		} catch {
			// Ignore: the panel simply shows what it already had.
		} finally {
			setLoading(false);
		}
	}, []);

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) void loadFeed();
	};

	const handleMarkAll = async () => {
		setMarkingAll(true);
		try {
			const result = await markAllNotificationsRead();
			if (result.success) {
				setUnread(0);
				setUnreadOnOpen(new Set());
				setFeed((current) => ({
					...current,
					items: current.items.map((item) => ({
						...item,
						readAt: item.readAt ?? new Date().toISOString(),
					})),
				}));
			}
		} catch {
			// Keep the previous state; the next open re-reads it.
		} finally {
			setMarkingAll(false);
		}
	};

	const visible = [...feed.startingSoon, ...feed.items];
	const label =
		unread > 0
			? `${unread} unread notification${unread === 1 ? "" : "s"}`
			: "Notifications";

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					className="relative"
					aria-label={label}
				>
					<IconBell />
					{unread > 0 && (
						<span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums">
							{unread > 9 ? "9+" : unread}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
					<span className="text-sm font-medium">Notifications</span>
					{(unread > 0 || feed.items.length > 0) && (
						<Button
							variant="ghost"
							size="sm"
							className="text-muted-foreground h-7 px-2 text-xs"
							onClick={handleMarkAll}
							disabled={markingAll || unread === 0}
						>
							<IconChecks className="size-3.5" />
							Mark all read
						</Button>
					)}
				</div>
				<div className="max-h-80 overflow-y-auto p-1">
					{loading && visible.length === 0 ? (
						<p className="text-muted-foreground px-2 py-6 text-center text-sm">
							Loading…
						</p>
					) : visible.length === 0 ? (
						<div className="px-2 py-8 text-center">
							<IconBell className="text-muted-foreground/60 mx-auto mb-2 size-6" />
							<p className="text-sm font-medium">You're all caught up</p>
							<p className="text-muted-foreground mt-1 text-xs">
								Booking activity will show up here.
							</p>
						</div>
					) : (
						<div className="grid gap-0.5">
							{visible.map((notification) => (
								<NotificationRow
									key={notification.id}
									notification={notification}
									unread={
										!notification.derived && unreadOnOpen.has(notification.id)
									}
									onNavigate={() => setOpen(false)}
								/>
							))}
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
