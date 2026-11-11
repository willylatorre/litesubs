"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface DocSection {
	id: string;
	title: string;
}

/** Distance from the viewport top that counts as "the heading just passed". */
const HEADING_OFFSET = 160;

/**
 * Sticky table of contents with scroll-spy.
 *
 * Deep links matter here (someone opening /docs#credits directly, or following
 * "See consumption examples" from the API token page), so the hash wins on
 * mount. After that, the active item is the last heading above the reading
 * line — with a special case for the bottom of the page, where the final
 * section can never reach that line.
 */
export function DocsNav({ sections }: { sections: DocSection[] }) {
	const [active, setActive] = useState(sections[0]?.id ?? "");

	useEffect(() => {
		const ids = sections.map((section) => section.id);
		const elements = ids
			.map((id) => document.getElementById(id))
			.filter((element): element is HTMLElement => Boolean(element));
		if (!elements.length) return;

		const fromHash = () => {
			const id = window.location.hash.replace(/^#/, "");
			if (ids.includes(id)) setActive(id);
		};
		fromHash();

		let frame = 0;
		const update = () => {
			frame = 0;
			const atBottom =
				window.innerHeight + window.scrollY >=
				document.documentElement.scrollHeight - 8;
			if (atBottom) {
				setActive(elements[elements.length - 1].id);
				return;
			}
			const passed = elements.filter(
				(element) => element.getBoundingClientRect().top <= HEADING_OFFSET,
			);
			setActive(passed.length ? passed[passed.length - 1].id : elements[0].id);
		};
		const onScroll = () => {
			if (!frame) frame = window.requestAnimationFrame(update);
		};

		update();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		window.addEventListener("hashchange", fromHash);
		return () => {
			if (frame) window.cancelAnimationFrame(frame);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			window.removeEventListener("hashchange", fromHash);
		};
	}, [sections]);

	return (
		<nav
			aria-label="Documentation sections"
			className="flex flex-wrap gap-x-4 gap-y-2 text-sm lg:flex-col lg:flex-nowrap lg:gap-1"
		>
			{sections.map((section) => {
				const isActive = section.id === active;
				return (
					<a
						key={section.id}
						href={`#${section.id}`}
						aria-current={isActive ? "location" : undefined}
						onClick={() => setActive(section.id)}
						className={cn(
							"rounded-md px-2.5 py-1.5 transition-colors lg:rounded-none lg:border-l lg:px-3",
							isActive
								? "bg-accent text-foreground lg:border-primary lg:bg-transparent lg:font-medium"
								: "text-muted-foreground hover:bg-accent/60 hover:text-foreground lg:border-border/70 lg:bg-transparent",
						)}
					>
						{section.title}
					</a>
				);
			})}
		</nav>
	);
}
