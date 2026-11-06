"use client";

import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMarkMissing } from "@/components/lens/session-tabs";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/** The one loading mark: a short bar travelling along a track. */
function LoadingBar({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"block h-[5px] w-[min(180px,50vw)] overflow-hidden rounded-full bg-card",
				className,
			)}
		>
			<span className="block h-full w-[44%] animate-loading rounded-full bg-muted-foreground/60 motion-reduce:mx-auto motion-reduce:animate-none" />
		</span>
	);
}

/** A whole page is on its way: the mark over the stage, below the session bar. */
export function PageLoading() {
	const t = useTranslations("status");
	return (
		<div
			role="status"
			aria-label={t("loading")}
			className="fixed inset-[var(--session-bar-height,0px)_0_0_var(--session-side-width,0px)] z-39 grid place-items-center bg-stage"
		>
			<div className="grid justify-items-center gap-9">
				<img src="/icon.svg" width="22" height="22" alt="" />
				<LoadingBar />
			</div>
		</div>
	);
}

/** Part of a page is on its way: the same mark, smaller, with what is loading. */
export function InlineLoading({
	label,
	className,
}: {
	label?: string;
	className?: string;
}) {
	const t = useTranslations("status");
	return (
		<div
			role="status"
			className={cn(
				"grid justify-items-center gap-3 py-10 text-[13px] text-muted-foreground",
				className,
			)}
		>
			<LoadingBar className="w-24 bg-muted" />
			{label ?? t("loading")}
		</div>
	);
}

/** Center the page-level wait indicator within the workspace's main pane. */
export function WorkspaceLoading() {
	return (
		<InlineLoading className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 py-0" />
	);
}

/** Nothing lives at this address: say so, and offer the way home. */
export function NotFound({
	title,
	className,
}: {
	title?: string;
	className?: string;
}) {
	const t = useTranslations("status");
	useMarkMissing();
	return (
		<Empty className={cn("min-h-[50dvh]", className)}>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<FileQuestion />
				</EmptyMedia>
				<EmptyTitle>{title ?? t("notFound")}</EmptyTitle>
				<EmptyDescription>{t("notFoundBody")}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button nativeButton={false} render={<Link href="/" />}>
					{t("backHome")}
				</Button>
			</EmptyContent>
		</Empty>
	);
}
