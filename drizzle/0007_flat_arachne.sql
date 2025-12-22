CREATE TABLE "lite_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_product_unique" UNIQUE("user_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "lite_subscriptions" ADD CONSTRAINT "lite_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lite_subscriptions" ADD CONSTRAINT "lite_subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lite_subscriptions" ADD CONSTRAINT "lite_subscriptions_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lite_subscriptions_user_idx" ON "lite_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lite_subscriptions_product_idx" ON "lite_subscriptions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "lite_subscriptions_creator_idx" ON "lite_subscriptions" USING btree ("creator_id");