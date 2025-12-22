import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		serverActions: {
			allowedOrigins: [
				"*.app.github.dev",
				"localhost:3000",
				"litesubs.com",
				"legendary-palm-tree-4qx6j57x66hg56-3000.app.github.dev",
				"3000-firebase-litesubs-1766156519822.cluster-kizalrzg35hz6u4i7pguwgt6ss.cloudworkstations.dev"
			],
		},
	}
};

export default nextConfig;
