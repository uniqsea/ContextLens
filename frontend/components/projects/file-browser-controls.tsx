import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import {
	BreadcrumbItem,
	BreadcrumbList,
	Breadcrumb as BreadcrumbNav,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import { FileIcon } from "./file-icon";

export function Breadcrumb({
	rootName,
	directory,
	navigate,
}: {
	rootName: string;
	directory: string;
	navigate: (path: string) => void;
}) {
	const t = useTranslations("projectFiles");
	const parts = directory ? directory.split("/") : [];
	return (
		<BreadcrumbNav aria-label={t("location")}>
			<BreadcrumbList>
				{[rootName, ...parts].map((name, i) => {
					const path = parts.slice(0, i).join("/");
					return (
						<Fragment key={path}>
							{i > 0 && <BreadcrumbSeparator />}
							<BreadcrumbItem>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									aria-current={i === parts.length ? "location" : undefined}
									onClick={() => navigate(path)}
								>
									{name}
								</Button>
							</BreadcrumbItem>
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</BreadcrumbNav>
	);
}
export function DirectoryLink({
	name,
	onOpen,
}: {
	name: string;
	onOpen: () => void;
}) {
	return (
		<Item
			size="xs"
			render={<button type="button" />}
			onClick={onOpen}
			className="flex-nowrap text-start hover:bg-muted"
		>
			<FileIcon directory name={name} />
			<span className="min-w-0 flex-1 truncate">{name}</span>
			<ChevronRight
				className="size-4 text-muted-foreground"
				aria-hidden="true"
			/>
		</Item>
	);
}
