"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

import { Wire } from "./wire";

export interface FlowNode {
	id: string;
	body: ReactNode;
	from: string[];
	highlight?: boolean;
}

export function StepFlow({
	columns,
	label,
}: {
	columns: FlowNode[][];
	label: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const layer = useRef<SVGGElement>(null);
	useLayoutEffect(() => {
		const graph = ref.current;
		const parent = layer.current;
		if (!graph || !parent) return;
		const elements = new Map(
			Array.from(
				graph.querySelectorAll<HTMLElement>("[data-flow-id]"),
				(el) => [el.dataset.flowId!, el],
			),
		);
		const links = columns.flat().flatMap((node) => {
			const end = elements.get(node.id);
			if (!end) return [];
			return node.from.flatMap((source) => {
				const start = elements.get(source);
				if (!start) return [];
				const wire = new Wire(parent, {
					color: "var(--l-mem)",
					endArrow: true,
				});
				wire.highlight(!!node.highlight && start.dataset.highlight === "true");
				return [{ wire, start, end }];
			});
		});
		const measure = () => {
			const box = graph.getBoundingClientRect();
			const scale = box.width / graph.offsetWidth;
			if (!scale) return;
			for (const link of links) {
				const start = link.start.getBoundingClientRect();
				const end = link.end.getBoundingClientRect();
				const startRow = link.start.parentElement!.getBoundingClientRect().top;
				const endRow = link.end.parentElement!.getBoundingClientRect().top;
				if (endRow > startRow + 1) {
					const rowTop = (endRow - box.top) / scale;
					link.wire.moveAcrossRow(
						(start.right - box.left) / scale,
						(start.top - box.top) / scale + 24,
						(end.left - box.left) / scale - 2,
						(end.top - box.top) / scale + 24,
						rowTop - 20,
					);
					continue;
				}
				link.wire.move(
					(start.right - box.left) / scale,
					(start.top - box.top) / scale + 24,
					(end.left - box.left) / scale - 2,
					(end.top - box.top) / scale + 24,
				);
			}
		};
		const observer = new ResizeObserver(measure);
		elements.forEach((el) => {
			observer.observe(el);
		});
		observer.observe(graph);
		measure();
		return () => {
			observer.disconnect();
			for (const link of links) link.wire.remove();
		};
	}, [columns]);
	return (
		<section className="turn-steps step-flow-scroll" aria-label={label}>
			<div className="step-flow" ref={ref}>
				<svg aria-hidden="true" className="step-flow-lines">
					<g ref={layer} />
				</svg>
				{columns
					.filter((col) => col.length)
					.map((col) => (
						<div className="flow-column" key={col[0].id}>
							{col.map((node) => (
								<div
									key={node.id}
									className="flow-node"
									data-flow-id={node.id}
									data-highlight={!!node.highlight}
								>
									{node.body}
								</div>
							))}
						</div>
					))}
			</div>
		</section>
	);
}
