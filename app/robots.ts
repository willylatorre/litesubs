import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: ["/api/", "/dashboard/"], // Typically exclude API and protected routes
		},
		sitemap: "https://litesubs.com/sitemap.xml",
	};
}
