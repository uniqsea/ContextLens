import { Folder, MessageSquare, Star } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Mix } from "@/lib/projects/types";
import { MiniField } from "./mini-field";

export function ProjectCard({
	href,
	title,
	preview,
	mix,
	chats,
	updated,
	project,
	starred,
	onStar,
	children,
}: {
	href: string;
	title: string;
	preview?: string;
	/** What its requests were made of; drawn as the cover once there is any. */
	mix?: Mix | null;
	chats?: number;
	updated?: string | null;
	project?: boolean;
	starred?: boolean;
	onStar?: () => void;
	children?: ReactNode;
}) {
	const t = useTranslations("projects");
	const format = useFormatter();
	return (
		<article className="pr-card">
			<Link href={href}>
				<div className="pr-cover">
					{mix ? (
						<MiniField mix={mix} />
					) : project ? (
						<Folder strokeWidth={1.15} />
					) : (
						<p>{preview || title}</p>
					)}
				</div>
				<div className="pr-caption">
					{project ? <Folder /> : <MessageSquare />}
					<div>
						<strong>{title}</strong>
						{/* The cover is a drawing now, so the words that were on it sit here. */}
						{(project || mix) && preview && <span>{preview}</span>}
						<p>
							{chats !== undefined && (
								<span>{t("chatCount", { count: chats })}</span>
							)}
							{updated && (
								<time dateTime={updated}>
									{format.dateTime(new Date(updated), {
										year: "numeric",
										month: "short",
										day: "numeric",
									})}
								</time>
							)}
						</p>
					</div>
				</div>
			</Link>
			{onStar && (
				<Button
					variant="quiet"
					size="icon-sm"
					className="absolute top-2 right-2 bg-background aria-pressed:bg-background aria-pressed:text-doc"
					aria-pressed={starred}
					aria-label={t("star", { name: title })}
					onClick={onStar}
				>
					<Star fill={starred ? "currentColor" : "none"} />
				</Button>
			)}
			{children}
		</article>
	);
}
