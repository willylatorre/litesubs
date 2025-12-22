import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		serverActions: {
			allowedOrigins: [
				"*.app.github.dev",
				"http://localhost:3000",
				"litesubs.com",
			],
		},
	},
};

export default nextConfig;
