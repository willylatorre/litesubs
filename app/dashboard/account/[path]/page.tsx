import { AccountView } from "@daveyplate/better-auth-ui";
import { accountViewPaths } from "@daveyplate/better-auth-ui/server";

export const dynamicParams = false;

export function generateStaticParams() {
	return Object.values(accountViewPaths).map((path) => ({ path }));
}

export default async function AccountPage({
	params,
}: {
	params: Promise<{ path: string }>;
}) {
	const { path } = await params;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<AccountView path={path} />
		</div>
	);
}
