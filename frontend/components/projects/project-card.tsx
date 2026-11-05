import { Folder, MessageSquare, Star } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

export function ProjectCard({
	href,
	title,
	preview,
	updated,
	project,
	starred,
	onStar,
}: {
	href: string;
	title: string;
	preview?: string;
	updated?: string | null;
	project?: boolean;
	starred?: boolean;
	onStar?: () => void;
}) {
	const t = useTranslations("projects");
	const format = useFormatter();
	return (
		<article className="pr-card">
			<Link href={href}>
				<div className="pr-cover">
					{project ? <Folder strokeWidth={1.15} /> : <p>{preview || title}</p>}
				</div>
				<div className="pr-caption">
					{project ? <Folder /> : <MessageSquare />}
					<div>
						<strong>{title}</strong>
						{project && preview && <span>{preview}</span>}
						{updated && (
							<time dateTime={updated}>
								{format.dateTime(new Date(updated), {
									year: "numeric",
									month: "short",
									day: "numeric",
								})}
							</time>
						)}
					</div>
				</div>
			</Link>
			{onStar && (
				<button
					type="button"
					className="pr-star"
					aria-pressed={starred}
					aria-label={t("star", { name: title })}
					onClick={onStar}
				>
					<Star fill={starred ? "currentColor" : "none"} />
				</button>
			)}
		</article>
	);
}
