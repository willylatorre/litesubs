import { redirect } from "next/navigation";

/**
 * The in-app developer docs used to render the same `IntegrationDocs` component
 * as the public `/docs` page, so the content existed twice and could drift.
 *
 * `/docs` is the single source: it is public, linked from the sitemap, and
 * referenced by `/llms.txt`. This route keeps the old dashboard URL working for
 * anyone with it open or bookmarked.
 */
export default function DevelopersPage() {
	redirect("/docs");
}
