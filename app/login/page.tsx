"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LoginForm } from "@/components/login-form";
import { authClient } from "@/lib/auth-client";



	// const handleSubmit = async (e: React.FormEvent) => {
	// 	e.preventDefault();
	// 	setError("");
	// 	setIsLoading(true);

	// 	try {
	// 		if (mode === "login") {
	// 			await authClient.signIn.email({
	// 				email,
	// 				password,
	// 			});
	// 		} else {
	// 			await authClient.signUp.email({
	// 				email,
	// 				password,
	// 				name: email.split("@")[0],
	// 			});
	// 		}
	// 		await navigate({ to: "/dashboard" });
	// 	} catch (err) {
	// 		setError(err instanceof Error ? err.message : "An error occurred");
	// 	} finally {
	// 		setIsLoading(false);
	// 	}
	// };
	
export default function Login() {
	return (
		<main className="min-h-screen flex items-center justify-center px-6">
			<LoginForm />
		</main>
	);
}
