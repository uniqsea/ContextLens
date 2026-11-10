"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

import { Wire } from "./wire";

// Columns run in processing order; lanes split what a stage reads (above),
// the stage itself (middle) and what it writes aside (below).
export type FlowLane = "input" | "main" | "side";
const lanes: FlowLane[] = ["input", "main", "side"];

export interface FlowNode {
	id: string;
	body: ReactNode;
	from: string[];
	lane?: FlowLane;
	highlight?: boolean;
}

// Wires enter and leave at the title line, so they stay put when a card opens.
const PORT_Y = 20;

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
					color: "var(--mem)",
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
				link.wire.move(
					(start.right - box.left) / scale,
					(start.top - box.top) / scale + PORT_Y,
					(end.left - box.left) / scale - 2,
					(end.top - box.top) / scale + PORT_Y,
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
	const filled = columns.filter((col) => col.length);
	const used = lanes.filter((lane) =>
		filled.some((col) => col.some((node) => (node.lane ?? "main") === lane)),
	);
	return (
		<section className="turn-steps step-flow-scroll" aria-label={label}>
			<div className="step-flow" ref={ref}>
				<svg aria-hidden="true" className="step-flow-lines">
					<g ref={layer} />
				</svg>
				{filled.flatMap((col, c) =>
					used.flatMap((lane, r) => {
						const nodes = col.filter((node) => (node.lane ?? "main") === lane);
						if (!nodes.length) return [];
						return (
							<div
								className="flow-cell"
								data-lane={lane}
								key={nodes[0].id}
								style={{ gridColumn: c + 1, gridRow: r + 1 }}
							>
								{nodes.map((node) => (
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
						);
					}),
				)}
			</div>
		</section>
	);
}
