import {
	Archive,
	BookOpenText,
	Braces,
	ChartNoAxesColumn,
	File,
	FileCode2,
	FileText,
	Film,
	Folder,
	Image,
	type LucideIcon,
	Music2,
	Presentation,
	Settings2,
	Table2,
	Type,
} from "lucide-react";

const formats: [LucideIcon, string, string][] = [
	[Presentation, "orange", "ppt pptx key odp"],
	[FileText, "red", "pdf"],
	[Image, "violet", "jpg jpeg png svg gif webp avif heic ico bmp tiff"],
	[Table2, "green", "xlsx xls ods csv tsv"],
	[BookOpenText, "blue", "md mdx markdown rst"],
	[FileText, "blue", "doc docx odt txt rtf tex"],
	[
		FileCode2,
		"teal",
		"js jsx ts tsx mjs cjs html htm css scss less py rb rs go java kt swift c cpp h hpp sh bash zsh vue svelte php sql",
	],
	[Braces, "orange", "json jsonl ndjson xml"],
	[Settings2, "slate", "yaml yml toml ini cfg conf lock"],
	[Film, "violet", "mp4 mov avi webm mkv"],
	[Music2, "teal", "mp3 wav flac aac m4a ogg"],
	[Archive, "orange", "zip tar gz bz2 xz rar 7z"],
	[Type, "violet", "woff woff2 ttf otf"],
	[ChartNoAxesColumn, "green", "ipynb"],
];

const extensions = new Map<string, [LucideIcon, string]>();
for (const [icon, tone, suffixes] of formats) {
	for (const suffix of suffixes.split(" "))
		extensions.set(suffix, [icon, tone]);
}

export function FileIcon({
	name,
	directory = false,
}: {
	name: string;
	directory?: boolean;
}) {
	const suffix = name.includes(".")
		? name.split(".").at(-1)?.toLowerCase()
		: "";
	const [Icon, tone] = directory
		? ([Folder, "folder"] as const)
		: (extensions.get(suffix ?? "") ?? ([File, "slate"] as const));
	return (
		<i aria-hidden="true" className="pr-file-icon" data-tone={tone}>
			<Icon />
		</i>
	);
}
