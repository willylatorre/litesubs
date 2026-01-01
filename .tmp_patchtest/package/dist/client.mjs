//#region src/client.ts
const stripeClient = (options) => {
	return {
		id: "stripe-client",
		$InferServerPlugin: {},
		pathMethods: {
			"/subscription/billing-portal": "POST",
			"/subscription/restore": "POST"
		}
	};
};

//#endregion
export { stripeClient };