import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	poweredByHeader: false,
	compress: true,
	experimental: {
		serverActions: {
			// A wildcard here (previously "*.app.github.dev") would let any
			// Codespaces origin invoke Server Actions. Keep the list explicit and
			// restrict developer hosts to non-production builds.
			allowedOrigins: [
				"litesubs.com",
				"www.litesubs.com",
				...(process.env.NODE_ENV === "production"
					? []
					: [
							"localhost:3000",
							"legendary-palm-tree-4qx6j57x66hg56-3000.app.github.dev",
							"3000-firebase-litesubs-1766156519822.cluster-kizalrzg35hz6u4i7pguwgt6ss.cloudworkstations.dev",
						]),
			],
		},
		// Helps tree-shake large icon packages.
		optimizePackageImports: ["lucide-react", "@tabler/icons-react"],
	},
};

export default nextConfig;
