"use client";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function LoginForm({
	className,
	...props
}: React.ComponentProps<"div">) {
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setIsLoading(true);
		const formData = new FormData(e.currentTarget);
		const email = formData.get("email") as string;
		const password = formData.get("password") as string;

		await authClient.signIn.email(
			{
				email,
				password,
			},
			{
				onSuccess: () => {
					setIsLoading(false);
					// Redirect handled by authClient or provider
					window.location.href = "/dashboard";
				},
				onError: (ctx) => {
					setIsLoading(false);
					console.error("Login error:", ctx);
                    if (ctx.error.status === 500) {
                        toast.error("System error. Please try again later or contact support.");
                    } else {
					    toast.error(ctx.error.message || "Failed to login");
                    }
				},
			},
		);
	};

	const handleSocialLogin = async (provider: "google" | "apple") => {
        // Apple is not configured in auth.ts, only Google is enabled: true
        if (provider === "apple") {
            toast.error("Apple login is not enabled yet.");
            return;
        }
		await authClient.signIn.social({
			provider,
			callbackURL: "/dashboard",
		});
	};

	return (
		<div className={cn("flex flex-col gap-6", className)} {...props}>
			<Card>
				<CardHeader className="text-center">
					<CardTitle className="text-xl">Welcome back</CardTitle>
					<CardDescription>
						Login with your Google account
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit}>
						<FieldGroup>
							<Field>
								<Button
									variant="outline"
									type="button"
									onClick={() => handleSocialLogin("google")}
                                    className="w-full"
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="mr-2 size-4">
										<path
											d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
											fill="currentColor"
										/>
									</svg>
									Login with Google
								</Button>
							</Field>
							<FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
								Or continue with email
							</FieldSeparator>
							<Field>
								<FieldLabel htmlFor="email">Email</FieldLabel>
								<Input
									id="email"
									name="email"
									type="email"
									placeholder="m@example.com"
									required
								/>
							</Field>
							<Field>
								<div className="flex items-center">
									<FieldLabel htmlFor="password">Password</FieldLabel>
									<a
										href="/auth/forgot-password"
										className="ml-auto text-sm underline-offset-4 hover:underline"
									>
										Forgot your password?
									</a>
								</div>
								<Input id="password" name="password" type="password" required />
							</Field>
							<Field>
								<Button type="submit" disabled={isLoading} className="w-full">
									{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
									Login
								</Button>
								<FieldDescription className="text-center mt-2">
									Don&apos;t have an account? <a href="/auth/sign-up" className="underline hover:text-primary">Sign up</a>
								</FieldDescription>
							</Field>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>
			<FieldDescription className="px-6 text-center">
				By clicking continue, you agree to our <a href="#" className="underline hover:text-primary">Terms of Service</a>{" "}
				and <a href="#" className="underline hover:text-primary">Privacy Policy</a>.
			</FieldDescription>
		</div>
	);
}
