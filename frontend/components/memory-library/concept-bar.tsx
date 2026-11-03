"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MenuSelect } from "@/components/lens/menu-select";
import { memoryApi } from "@/lib/memory-api";
import type { Concept } from "@/lib/memory-types";

/** Browse by concept, and fix the concepts themselves: rename, merge two names for one thing, or
 * split one name that covers two things. */
export function ConceptBar({
	concepts,
	selected,
	onSelect,
	picking,
	picked,
	onPicking,
	onChange,
}: {
	concepts: Concept[];
	selected: string | null;
	onSelect: (id: string | null) => void;
	picking: boolean;
	picked: string[];
	onPicking: (on: boolean) => void;
	onChange: (change: () => Promise<unknown>) => void;
}) {
	const t = useTranslations("library");
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState(false);
	const concept = concepts.find((c) => c.id === selected);
	if (!concepts.length) return null;

	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: a filter strip, not a form section */}
			<div className="lib-concepts" role="group" aria-label={t("allConcepts")}>
				<button
					type="button"
					className="lens-chip"
					aria-pressed={!concept}
					onClick={() => onSelect(null)}
				>
					{t("allConcepts")}
				</button>
				{concepts.map((c) => (
					<button
						key={c.id}
						type="button"
						className="lens-chip"
						aria-pressed={concept?.id === c.id}
						onClick={() => {
							onSelect(c.id);
							setRenaming(false);
						}}
					>
						{c.name}
						<small>{c.count}</small>
					</button>
				))}
			</div>
			{concept && (
				<div className="lib-concept-tools">
					{concept.aliases.length > 0 && (
						<span>{concept.aliases.join(" · ")}</span>
					)}
					{renaming ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								setRenaming(false);
								if (name.trim())
									onChange(() =>
										memoryApi.renameConcept(concept.id, name.trim()),
									);
							}}
						>
							<input
								// biome-ignore lint/a11y/noAutofocus: the field appears because it was asked for
								autoFocus
								type="text"
								className="lens-input"
								value={name}
								aria-label={t("rename")}
								onChange={(e) => setName(e.target.value)}
							/>
						</form>
					) : (
						<button
							type="button"
							className="lens-act"
							onClick={() => {
								setName(concept.name);
								setRenaming(true);
							}}
						>
							{t("rename")}
						</button>
					)}
					{concepts.length > 1 && (
						<MenuSelect
							label={t("mergeInto")}
							placeholder={t("mergeInto")}
							options={concepts
								.filter((c) => c.id !== concept.id)
								.map((c) => ({ value: c.id, label: c.name }))}
							onChange={(keep) => {
								onChange(() => memoryApi.mergeConcepts(keep, concept.id));
								onSelect(keep);
							}}
						/>
					)}
					{picking ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								if (!name.trim() || !picked.length) return;
								onChange(() =>
									memoryApi.splitConcept(concept.id, name.trim(), picked),
								);
								setName("");
								onPicking(false);
							}}
						>
							<input
								type="text"
								className="lens-input"
								value={name}
								placeholder={t("splitName")}
								aria-label={t("splitName")}
								onChange={(e) => setName(e.target.value)}
							/>
							<button type="submit" className="lens-act">
								{t("splitDone")}
							</button>
							<button
								type="button"
								className="lens-act"
								onClick={() => onPicking(false)}
							>
								{t("cancelSplit")}
							</button>
						</form>
					) : (
						<button
							type="button"
							className="lens-act"
							onClick={() => {
								setName("");
								onPicking(true);
							}}
						>
							{t("split")}
						</button>
					)}
				</div>
			)}
		</>
	);
}
