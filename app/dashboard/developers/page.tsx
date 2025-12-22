import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export default function DevelopersPage() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				<div className="flex items-center justify-between px-4 lg:px-6">
					<h1 className="text-2xl font-bold tracking-tight">Developers</h1>
				</div>

				<div className="grid gap-4 px-4 lg:px-6">
					<Card>
						<CardHeader>
							<CardTitle>API Access</CardTitle>
							<CardDescription>
								Use these endpoints to integrate with your application.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							<div className="grid gap-2">
								<h3 className="font-medium">Authentication</h3>
								<p className="text-sm text-muted-foreground">
									Currently, API routes share the same session-based
									authentication as the dashboard. API Key authentication is
									coming soon.
								</p>
							</div>

							<div className="grid gap-2">
								<div className="flex items-center gap-2">
									<Badge>GET</Badge>
									<code className="text-sm bg-muted px-1 py-0.5 rounded">
										/api/invites
									</code>
								</div>
								<p className="text-sm text-muted-foreground">
									List all invites sent by you.
								</p>
							</div>

							<div className="grid gap-2">
								<div className="flex items-center gap-2">
									<Badge>POST</Badge>
									<code className="text-sm bg-muted px-1 py-0.5 rounded">
										/api/invites
									</code>
								</div>
								<p className="text-sm text-muted-foreground">
									Send a new invite. Body:{" "}
									<code>{`{ "email": "user@example.com" }`}</code>
								</p>
							</div>

							<div className="grid gap-2">
								<div className="flex items-center gap-2">
									<Badge>GET</Badge>
									<code className="text-sm bg-muted px-1 py-0.5 rounded">
										/api/products
									</code>
								</div>
								<p className="text-sm text-muted-foreground">
									List all your products.
								</p>
							</div>

							<div className="grid gap-2">
								<div className="flex items-center gap-2">
									<Badge>POST</Badge>
									<code className="text-sm bg-muted px-1 py-0.5 rounded">
										/api/products
									</code>
								</div>
								<p className="text-sm text-muted-foreground">
									Create a new product. Body:{" "}
									<code>{`{ "name": "...", "price": 10, "credits": 100 }`}</code>
								</p>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
