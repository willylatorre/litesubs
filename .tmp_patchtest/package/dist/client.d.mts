import { n as stripe } from "./index-DtwvPnmn.mjs";

//#region src/client.d.ts
declare const stripeClient: <O extends {
  subscription: boolean;
}>(options?: O | undefined) => {
  id: "stripe-client";
  $InferServerPlugin: ReturnType<typeof stripe<O["subscription"] extends true ? {
    stripeClient: any;
    stripeWebhookSecret: string;
    subscription: {
      enabled: true;
      plans: [];
    };
  } : {
    stripeClient: any;
    stripeWebhookSecret: string;
  }>>;
  pathMethods: {
    "/subscription/billing-portal": "POST";
    "/subscription/restore": "POST";
  };
};
//#endregion
export { stripeClient };