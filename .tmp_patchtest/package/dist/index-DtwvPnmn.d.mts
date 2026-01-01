import * as better_auth0 from "better-auth";
import { GenericEndpointContext, InferOptionSchema, Session, User } from "better-auth";
import * as better_call0 from "better-call";
import * as zod0 from "zod";
import Stripe from "stripe";

//#region src/schema.d.ts
declare const subscriptions: {
  subscription: {
    fields: {
      plan: {
        type: "string";
        required: true;
      };
      referenceId: {
        type: "string";
        required: true;
      };
      stripeCustomerId: {
        type: "string";
        required: false;
      };
      stripeSubscriptionId: {
        type: "string";
        required: false;
      };
      status: {
        type: "string";
        defaultValue: string;
      };
      periodStart: {
        type: "date";
        required: false;
      };
      periodEnd: {
        type: "date";
        required: false;
      };
      trialStart: {
        type: "date";
        required: false;
      };
      trialEnd: {
        type: "date";
        required: false;
      };
      cancelAtPeriodEnd: {
        type: "boolean";
        required: false;
        defaultValue: false;
      };
      cancelAt: {
        type: "date";
        required: false;
      };
      canceledAt: {
        type: "date";
        required: false;
      };
      endedAt: {
        type: "date";
        required: false;
      };
      seats: {
        type: "number";
        required: false;
      };
    };
  };
};
declare const user: {
  user: {
    fields: {
      stripeCustomerId: {
        type: "string";
        required: false;
      };
    };
  };
};
//#endregion
//#region src/types.d.ts
type StripePlan = {
  /**
   * Monthly price id
   */
  priceId?: string | undefined;
  /**
   * To use lookup key instead of price id
   *
   * https://docs.stripe.com/products-prices/
   * manage-prices#lookup-keys
   */
  lookupKey?: string | undefined;
  /**
   * A yearly discount price id
   *
   * useful when you want to offer a discount for
   * yearly subscription
   */
  annualDiscountPriceId?: string | undefined;
  /**
   * To use lookup key instead of price id
   *
   * https://docs.stripe.com/products-prices/
   * manage-prices#lookup-keys
   */
  annualDiscountLookupKey?: string | undefined;
  /**
   * Plan name
   */
  name: string;
  /**
   * Limits for the plan
   *
   * useful when you want to define plan-specific metadata.
   */
  limits?: Record<string, unknown> | undefined;
  /**
   * Plan group name
   *
   * useful when you want to group plans or
   * when a user can subscribe to multiple plans.
   */
  group?: string | undefined;
  /**
   * Free trial days
   */
  freeTrial?: {
    /**
     * Number of days
     */
    days: number;
    /**
     * A function that will be called when the trial
     * starts.
     *
     * @param subscription
     * @returns
     */
    onTrialStart?: (subscription: Subscription) => Promise<void>;
    /**
     * A function that will be called when the trial
     * ends
     *
     * @param subscription - Subscription
     * @returns
     */
    onTrialEnd?: (data: {
      subscription: Subscription;
    }, ctx: GenericEndpointContext) => Promise<void>;
    /**
     * A function that will be called when the trial
     * expired.
     * @param subscription - Subscription
     * @returns
     */
    onTrialExpired?: (subscription: Subscription, ctx: GenericEndpointContext) => Promise<void>;
  } | undefined;
};
interface Subscription {
  /**
   * Database identifier
   */
  id: string;
  /**
   * The plan name
   */
  plan: string;
  /**
   * Stripe customer id
   */
  stripeCustomerId?: string | undefined;
  /**
   * Stripe subscription id
   */
  stripeSubscriptionId?: string | undefined;
  /**
   * Trial start date
   */
  trialStart?: Date | undefined;
  /**
   * Trial end date
   */
  trialEnd?: Date | undefined;
  /**
   * Price Id for the subscription
   */
  priceId?: string | undefined;
  /**
   * To what reference id the subscription belongs to
   * @example
   * - userId for a user
   * - workspace id for a saas platform
   * - website id for a hosting platform
   *
   * @default - userId
   */
  referenceId: string;
  /**
   * Subscription status
   */
  status: "active" | "canceled" | "incomplete" | "incomplete_expired" | "past_due" | "paused" | "trialing" | "unpaid";
  /**
   * The billing cycle start date
   */
  periodStart?: Date | undefined;
  /**
   * The billing cycle end date
   */
  periodEnd?: Date | undefined;
  /**
   * Whether this subscription will (if status=active)
   * or did (if status=canceled) cancel at the end of the current billing period.
   */
  cancelAtPeriodEnd?: boolean | undefined;
  /**
   * If the subscription is scheduled to be canceled,
   * this is the time at which the cancellation will take effect.
   */
  cancelAt?: Date | undefined;
  /**
   * If the subscription has been canceled, this is the time when it was canceled.
   *
   * Note: If the subscription was canceled with `cancel_at_period_end`,
   * this reflects the cancellation request time, not when the subscription actually ends.
   */
  canceledAt?: Date | undefined;
  /**
   * If the subscription has ended, the date the subscription ended.
   */
  endedAt?: Date | undefined;
  /**
   * A field to group subscriptions so you can have multiple subscriptions
   * for one reference id
   */
  groupId?: string | undefined;
  /**
   * Number of seats for the subscription (useful for team plans)
   */
  seats?: number | undefined;
}
type SubscriptionOptions = {
  /**
   * Subscription Configuration
   */
  /**
   * List of plan
   */
  plans: StripePlan[] | (() => StripePlan[] | Promise<StripePlan[]>);
  /**
   * Require email verification before a user is allowed to upgrade
   * their subscriptions
   *
   * @default false
   */
  requireEmailVerification?: boolean | undefined;
  /**
   * A callback to run after a user has subscribed to a package
   * @param event - Stripe Event
   * @param subscription - Subscription Data
   * @returns
   */
  onSubscriptionComplete?: ((data: {
    event: Stripe.Event;
    stripeSubscription: Stripe.Subscription;
    subscription: Subscription;
    plan: StripePlan;
  }, ctx: GenericEndpointContext) => Promise<void>) | undefined;
  /**
   * A callback to run after a user is about to cancel their subscription
   * @returns
   */
  onSubscriptionUpdate?: ((data: {
    event: Stripe.Event;
    subscription: Subscription;
  }) => Promise<void>) | undefined;
  /**
   * A callback to run after a user is about to cancel their subscription
   * @returns
   */
  onSubscriptionCancel?: ((data: {
    event?: Stripe.Event;
    subscription: Subscription;
    stripeSubscription: Stripe.Subscription;
    cancellationDetails?: Stripe.Subscription.CancellationDetails | null;
  }) => Promise<void>) | undefined;
  /**
   * A function to check if the reference id is valid
   * and belongs to the user
   *
   * @param data - data containing user, session and referenceId
   * @param ctx - the context object
   * @returns
   */
  authorizeReference?: ((data: {
    user: User & Record<string, any>;
    session: Session & Record<string, any>;
    referenceId: string;
    action: "upgrade-subscription" | "list-subscription" | "cancel-subscription" | "restore-subscription" | "billing-portal";
  }, ctx: GenericEndpointContext) => Promise<boolean>) | undefined;
  /**
   * A callback to run after a user has deleted their subscription
   * @returns
   */
  onSubscriptionDeleted?: ((data: {
    event: Stripe.Event;
    stripeSubscription: Stripe.Subscription;
    subscription: Subscription;
  }) => Promise<void>) | undefined;
  /**
   * A callback to run when a subscription is created
   * @returns
   */
  onSubscriptionCreated?: ((data: {
    event: Stripe.Event;
    stripeSubscription: Stripe.Subscription;
    subscription: Subscription;
    plan: StripePlan;
  }) => Promise<void>) | undefined;
  /**
   * parameters for session create params
   *
   * @param data - data containing user, session and plan
   * @param req - the request object
   * @param ctx - the context object
   */
  getCheckoutSessionParams?: ((data: {
    user: User & Record<string, any>;
    session: Session & Record<string, any>;
    plan: StripePlan;
    subscription: Subscription;
  }, req: GenericEndpointContext["request"], ctx: GenericEndpointContext) => Promise<{
    params?: Stripe.Checkout.SessionCreateParams;
    options?: Stripe.RequestOptions;
  }> | {
    params?: Stripe.Checkout.SessionCreateParams;
    options?: Stripe.RequestOptions;
  }) | undefined;
  /**
   * Enable organization subscription
   */
  organization?: {
    enabled: boolean;
  } | undefined;
};
interface StripeOptions {
  /**
   * Stripe Client
   */
  stripeClient: Stripe;
  /**
   * Stripe Webhook Secret
   *
   * @description Stripe webhook secret key
   */
  stripeWebhookSecret: string;
  /**
   * Enable customer creation when a user signs up
   */
  createCustomerOnSignUp?: boolean | undefined;
  /**
   * A callback to run after a customer has been created
   * @param customer - Customer Data
   * @param stripeCustomer - Stripe Customer Data
   * @returns
   */
  onCustomerCreate?: ((data: {
    stripeCustomer: Stripe.Customer;
    user: User & {
      stripeCustomerId: string;
    };
  }, ctx: GenericEndpointContext) => Promise<void>) | undefined;
  /**
   * A custom function to get the customer create
   * params
   * @param data - data containing user and session
   * @returns
   */
  getCustomerCreateParams?: ((user: User, ctx: GenericEndpointContext) => Promise<Partial<Stripe.CustomerCreateParams>>) | undefined;
  /**
   * Subscriptions
   */
  subscription?: ({
    enabled: false;
  } | ({
    enabled: true;
  } & SubscriptionOptions)) | undefined;
  /**
   * A callback to run after a stripe event is received
   * @param event - Stripe Event
   * @returns
   */
  onEvent?: ((event: Stripe.Event) => Promise<void>) | undefined;
  /**
   * Schema for the stripe plugin
   */
  schema?: InferOptionSchema<typeof subscriptions & typeof user> | undefined;
}
//#endregion
//#region src/index.d.ts
declare const stripe: <O extends StripeOptions>(options: O) => {
  id: "stripe";
  endpoints: {
    stripeWebhook: better_call0.StrictEndpoint<"/stripe/webhook", {
      method: "POST";
      metadata: {
        openapi: {
          operationId: string;
        };
        scope: "server";
      };
      cloneRequest: true;
      disableBody: true;
    }, {
      success: boolean;
    }>;
  } & (O["subscription"] extends {
    enabled: true;
  } ? {
    upgradeSubscription: better_call0.StrictEndpoint<"/subscription/upgrade", {
      method: "POST";
      body: zod0.ZodObject<{
        plan: zod0.ZodString;
        annual: zod0.ZodOptional<zod0.ZodBoolean>;
        referenceId: zod0.ZodOptional<zod0.ZodString>;
        subscriptionId: zod0.ZodOptional<zod0.ZodString>;
        metadata: zod0.ZodOptional<zod0.ZodRecord<zod0.ZodString, zod0.ZodAny>>;
        seats: zod0.ZodOptional<zod0.ZodNumber>;
        successUrl: zod0.ZodDefault<zod0.ZodString>;
        cancelUrl: zod0.ZodDefault<zod0.ZodString>;
        returnUrl: zod0.ZodOptional<zod0.ZodString>;
        disableRedirect: zod0.ZodDefault<zod0.ZodBoolean>;
      }, better_auth0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
        };
      };
      use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>) | ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>))[];
    }, {
      url: string;
      redirect: boolean;
    } | {
      redirect: boolean;
      id: string;
      object: "checkout.session";
      adaptive_pricing: Stripe.Checkout.Session.AdaptivePricing | null;
      after_expiration: Stripe.Checkout.Session.AfterExpiration | null;
      allow_promotion_codes: boolean | null;
      amount_subtotal: number | null;
      amount_total: number | null;
      automatic_tax: Stripe.Checkout.Session.AutomaticTax;
      billing_address_collection: Stripe.Checkout.Session.BillingAddressCollection | null;
      branding_settings?: Stripe.Checkout.Session.BrandingSettings;
      cancel_url: string | null;
      client_reference_id: string | null;
      client_secret: string | null;
      collected_information: Stripe.Checkout.Session.CollectedInformation | null;
      consent: Stripe.Checkout.Session.Consent | null;
      consent_collection: Stripe.Checkout.Session.ConsentCollection | null;
      created: number;
      currency: string | null;
      currency_conversion: Stripe.Checkout.Session.CurrencyConversion | null;
      custom_fields: Array<Stripe.Checkout.Session.CustomField>;
      custom_text: Stripe.Checkout.Session.CustomText;
      customer: string | Stripe.Customer | Stripe.DeletedCustomer | null;
      customer_creation: Stripe.Checkout.Session.CustomerCreation | null;
      customer_details: Stripe.Checkout.Session.CustomerDetails | null;
      customer_email: string | null;
      discounts: Array<Stripe.Checkout.Session.Discount> | null;
      excluded_payment_method_types?: Array<string>;
      expires_at: number;
      invoice: string | Stripe.Invoice | null;
      invoice_creation: Stripe.Checkout.Session.InvoiceCreation | null;
      line_items?: Stripe.ApiList<Stripe.LineItem>;
      livemode: boolean;
      locale: Stripe.Checkout.Session.Locale | null;
      metadata: Stripe.Metadata | null;
      mode: Stripe.Checkout.Session.Mode;
      name_collection?: Stripe.Checkout.Session.NameCollection;
      optional_items?: Array<Stripe.Checkout.Session.OptionalItem> | null;
      origin_context: Stripe.Checkout.Session.OriginContext | null;
      payment_intent: string | Stripe.PaymentIntent | null;
      payment_link: string | Stripe.PaymentLink | null;
      payment_method_collection: Stripe.Checkout.Session.PaymentMethodCollection | null;
      payment_method_configuration_details: Stripe.Checkout.Session.PaymentMethodConfigurationDetails | null;
      payment_method_options: Stripe.Checkout.Session.PaymentMethodOptions | null;
      payment_method_types: Array<string>;
      payment_status: Stripe.Checkout.Session.PaymentStatus;
      permissions: Stripe.Checkout.Session.Permissions | null;
      phone_number_collection?: Stripe.Checkout.Session.PhoneNumberCollection;
      presentment_details?: Stripe.Checkout.Session.PresentmentDetails;
      recovered_from: string | null;
      redirect_on_completion?: Stripe.Checkout.Session.RedirectOnCompletion;
      return_url?: string;
      saved_payment_method_options: Stripe.Checkout.Session.SavedPaymentMethodOptions | null;
      setup_intent: string | Stripe.SetupIntent | null;
      shipping_address_collection: Stripe.Checkout.Session.ShippingAddressCollection | null;
      shipping_cost: Stripe.Checkout.Session.ShippingCost | null;
      shipping_options: Array<Stripe.Checkout.Session.ShippingOption>;
      status: Stripe.Checkout.Session.Status | null;
      submit_type: Stripe.Checkout.Session.SubmitType | null;
      subscription: string | Stripe.Subscription | null;
      success_url: string | null;
      tax_id_collection?: Stripe.Checkout.Session.TaxIdCollection;
      total_details: Stripe.Checkout.Session.TotalDetails | null;
      ui_mode: Stripe.Checkout.Session.UiMode | null;
      url: string | null;
      wallet_options: Stripe.Checkout.Session.WalletOptions | null;
      lastResponse: {
        headers: {
          [key: string]: string;
        };
        requestId: string;
        statusCode: number;
        apiVersion?: string;
        idempotencyKey?: string;
        stripeAccount?: string;
      };
    }>;
    cancelSubscriptionCallback: better_call0.StrictEndpoint<"/subscription/cancel/callback", {
      method: "GET";
      query: zod0.ZodOptional<zod0.ZodRecord<zod0.ZodString, zod0.ZodAny>>;
      metadata: {
        openapi: {
          operationId: string;
        };
      };
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
    }, never>;
    cancelSubscription: better_call0.StrictEndpoint<"/subscription/cancel", {
      method: "POST";
      body: zod0.ZodObject<{
        referenceId: zod0.ZodOptional<zod0.ZodString>;
        subscriptionId: zod0.ZodOptional<zod0.ZodString>;
        returnUrl: zod0.ZodString;
        disableRedirect: zod0.ZodDefault<zod0.ZodBoolean>;
      }, better_auth0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
        };
      };
      use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>) | ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>))[];
    }, {
      url: string;
      redirect: boolean;
    }>;
    restoreSubscription: better_call0.StrictEndpoint<"/subscription/restore", {
      method: "POST";
      body: zod0.ZodObject<{
        referenceId: zod0.ZodOptional<zod0.ZodString>;
        subscriptionId: zod0.ZodOptional<zod0.ZodString>;
      }, better_auth0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
        };
      };
      use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>) | ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>))[];
    }, Stripe.Response<Stripe.Subscription>>;
    listActiveSubscriptions: better_call0.StrictEndpoint<"/subscription/list", {
      method: "GET";
      query: zod0.ZodOptional<zod0.ZodObject<{
        referenceId: zod0.ZodOptional<zod0.ZodString>;
      }, better_auth0.$strip>>;
      metadata: {
        openapi: {
          operationId: string;
        };
      };
      use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>) | ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>))[];
    }, {
      limits: Record<string, unknown> | undefined;
      priceId: string | undefined;
      id: string;
      plan: string;
      stripeCustomerId?: string | undefined;
      stripeSubscriptionId?: string | undefined;
      trialStart?: Date | undefined;
      trialEnd?: Date | undefined;
      referenceId: string;
      status: "active" | "canceled" | "incomplete" | "incomplete_expired" | "past_due" | "paused" | "trialing" | "unpaid";
      periodStart?: Date | undefined;
      periodEnd?: Date | undefined;
      cancelAtPeriodEnd?: boolean | undefined;
      cancelAt?: Date | undefined;
      canceledAt?: Date | undefined;
      endedAt?: Date | undefined;
      groupId?: string | undefined;
      seats?: number | undefined;
    }[]>;
    subscriptionSuccess: better_call0.StrictEndpoint<"/subscription/success", {
      method: "GET";
      query: zod0.ZodOptional<zod0.ZodRecord<zod0.ZodString, zod0.ZodAny>>;
      metadata: {
        openapi: {
          operationId: string;
        };
      };
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
    }, {
      status: ("OK" | "CREATED" | "ACCEPTED" | "NO_CONTENT" | "MULTIPLE_CHOICES" | "MOVED_PERMANENTLY" | "FOUND" | "SEE_OTHER" | "NOT_MODIFIED" | "TEMPORARY_REDIRECT" | "BAD_REQUEST" | "UNAUTHORIZED" | "PAYMENT_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "NOT_ACCEPTABLE" | "PROXY_AUTHENTICATION_REQUIRED" | "REQUEST_TIMEOUT" | "CONFLICT" | "GONE" | "LENGTH_REQUIRED" | "PRECONDITION_FAILED" | "PAYLOAD_TOO_LARGE" | "URI_TOO_LONG" | "UNSUPPORTED_MEDIA_TYPE" | "RANGE_NOT_SATISFIABLE" | "EXPECTATION_FAILED" | "I'M_A_TEAPOT" | "MISDIRECTED_REQUEST" | "UNPROCESSABLE_ENTITY" | "LOCKED" | "FAILED_DEPENDENCY" | "TOO_EARLY" | "UPGRADE_REQUIRED" | "PRECONDITION_REQUIRED" | "TOO_MANY_REQUESTS" | "REQUEST_HEADER_FIELDS_TOO_LARGE" | "UNAVAILABLE_FOR_LEGAL_REASONS" | "INTERNAL_SERVER_ERROR" | "NOT_IMPLEMENTED" | "BAD_GATEWAY" | "SERVICE_UNAVAILABLE" | "GATEWAY_TIMEOUT" | "HTTP_VERSION_NOT_SUPPORTED" | "VARIANT_ALSO_NEGOTIATES" | "INSUFFICIENT_STORAGE" | "LOOP_DETECTED" | "NOT_EXTENDED" | "NETWORK_AUTHENTICATION_REQUIRED") | better_call0.Status;
      body: ({
        message?: string;
        code?: string;
        cause?: unknown;
      } & Record<string, any>) | undefined;
      headers: HeadersInit;
      statusCode: number;
      name: string;
      message: string;
      stack?: string;
      cause?: unknown;
    }>;
    createBillingPortal: better_call0.StrictEndpoint<"/subscription/billing-portal", {
      method: "POST";
      body: zod0.ZodObject<{
        locale: zod0.ZodOptional<zod0.ZodCustom<Stripe.Checkout.Session.Locale, Stripe.Checkout.Session.Locale>>;
        referenceId: zod0.ZodOptional<zod0.ZodString>;
        returnUrl: zod0.ZodDefault<zod0.ZodString>;
        disableRedirect: zod0.ZodDefault<zod0.ZodBoolean>;
      }, better_auth0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
        };
      };
      use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>) | ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>))[];
    }, {
      url: string;
      redirect: boolean;
    }>;
  } : {});
  init(ctx: better_auth0.AuthContext): {
    options: {
      databaseHooks: {
        user: {
          create: {
            after(user: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & Record<string, unknown>, ctx: better_auth0.GenericEndpointContext | null): Promise<void>;
          };
          update: {
            after(user: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & Record<string, unknown>, ctx: better_auth0.GenericEndpointContext | null): Promise<void>;
          };
        };
      };
    };
  };
  schema: {};
  options: NoInfer<O>;
  $ERROR_CODES: {
    readonly SUBSCRIPTION_NOT_FOUND: "Subscription not found";
    readonly SUBSCRIPTION_PLAN_NOT_FOUND: "Subscription plan not found";
    readonly ALREADY_SUBSCRIBED_PLAN: "You're already subscribed to this plan";
    readonly UNABLE_TO_CREATE_CUSTOMER: "Unable to create customer";
    readonly FAILED_TO_FETCH_PLANS: "Failed to fetch plans";
    readonly EMAIL_VERIFICATION_REQUIRED: "Email verification is required before you can subscribe to a plan";
    readonly SUBSCRIPTION_NOT_ACTIVE: "Subscription is not active";
    readonly SUBSCRIPTION_NOT_SCHEDULED_FOR_CANCELLATION: "Subscription is not scheduled for cancellation";
  };
};
type StripePlugin<O extends StripeOptions> = ReturnType<typeof stripe<O>>;
//#endregion
export { SubscriptionOptions as a, Subscription as i, stripe as n, StripePlan as r, StripePlugin as t };