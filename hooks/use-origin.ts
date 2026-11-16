"use client";

import { useEffect, useState } from "react";

/**
 * The browser's own origin, empty during the server render.
 *
 * `window` cannot be read while rendering on the server, so consumers start
 * with the canonical server URL and re-host it once mounted.
 */
export function useOrigin() {
	const [origin, setOrigin] = useState("");

	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);

	return origin;
}
