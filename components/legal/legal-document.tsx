import Link from "next/link";
import { PublicShell } from "@/components/public-shell";

export type LegalBlock =
	| { type: "paragraph"; text: string }
	| { type: "list"; items: string[] }
	| { type: "subheading"; text: string };

export type LegalSection = {
	id: string;
	title: string;
	blocks: LegalBlock[];
};

type LegalDocumentProps = {
	eyebrow: string;
	title: string;
	summary: string;
	lastUpdated: string;
	sections: LegalSection[];
};

/**
 * Shared chrome for static policy pages. Content lives in the page file as data
 * so the prose stays easy to review and edit; this component only handles
 * headings, anchors, and the table of contents.
 */
export function LegalDocument({
	eyebrow,
	title,
	summary,
	lastUpdated,
	sections,
}: LegalDocumentProps) {
	return (
		<PublicShell>
			<main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6 md:py-14">
				<header className="space-y-3">
					<p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						{eyebrow}
					</p>
					<h1 className="text-3xl font-bold tracking-tight md:text-4xl">
						{title}
					</h1>
					<p className="text-muted-foreground md:text-lg">{summary}</p>
					<p className="text-sm text-muted-foreground">
						Last updated <time dateTime={lastUpdated}>{lastUpdated}</time>
					</p>
				</header>

				<nav
					aria-label="On this page"
					className="mt-8 rounded-lg border bg-muted/40 p-5"
				>
					<p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						On this page
					</p>
					<ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
						{sections.map((section, index) => (
							<li key={section.id} className="flex gap-2">
								<span className="tabular-nums text-muted-foreground">
									{index + 1}.
								</span>
								<a
									href={`#${section.id}`}
									className="text-foreground underline-offset-4 hover:underline"
								>
									{section.title}
								</a>
							</li>
						))}
					</ol>
				</nav>

				<div className="mt-10 space-y-10">
					{sections.map((section, index) => (
						<section
							key={section.id}
							id={section.id}
							className="scroll-mt-24 space-y-4"
						>
							<h2 className="flex items-baseline gap-2 text-xl font-semibold tracking-tight md:text-2xl">
								<span className="text-muted-foreground">{index + 1}.</span>
								{section.title}
							</h2>
							{section.blocks.map((block) => (
								<LegalBlockView
									key={blockKey(section.id, block)}
									block={block}
								/>
							))}
						</section>
					))}
				</div>

				<hr className="my-10 border-border/70" />

				<p className="text-sm text-muted-foreground">
					Questions about this page? Email{" "}
					<Link
						href="mailto:hello@litesubs.com"
						className="underline underline-offset-4"
					>
						hello@litesubs.com
					</Link>
					.
				</p>
			</main>
		</PublicShell>
	);
}

/**
 * Prose blocks are static data, so their text is a stable identity within a
 * section's block list.
 */
function blockKey(sectionId: string, block: LegalBlock): string {
	return `${sectionId}-${block.type}-${block.type === "list" ? block.items[0] : block.text}`;
}

function LegalBlockView({ block }: { block: LegalBlock }) {
	if (block.type === "subheading") {
		return (
			<h3 className="pt-2 text-base font-semibold text-foreground">
				{block.text}
			</h3>
		);
	}

	if (block.type === "list") {
		return (
			<ul className="list-disc space-y-2 pl-5 text-muted-foreground marker:text-border">
				{block.items.map((item) => (
					<li key={item} className="leading-relaxed">
						{item}
					</li>
				))}
			</ul>
		);
	}

	return <p className="leading-relaxed text-muted-foreground">{block.text}</p>;
}
