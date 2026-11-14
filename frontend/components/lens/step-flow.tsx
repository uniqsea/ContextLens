"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

import { Wire } from "./wire";

// Columns run in processing order; lanes split what a stage reads (above),
// the stage itself (middle) and what it writes aside (below).
export type FlowLane = "input" | "main" | "side";

export interface FlowNode {
	id: string;
	body: ReactNode;
	from: string[];
	lane?: FlowLane;
	highlight?: boolean;
	/** A source or a tool result: the wires leaving it carry its kind's colour. */
	color?: string;
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
		const colors = new Map(columns.flat().map((n) => [n.id, n.color]));
		const links = columns.flat().flatMap((node) => {
			const end = elements.get(node.id);
			if (!end) return [];
			return node.from.flatMap((source) => {
				const start = elements.get(source);
				if (!start) return [];
				// What was read flows in along its own colour; the order of work stays ink.
				const color = colors.get(source);
				const wire = new Wire(parent, {
					color: color ?? "var(--mem)",
					ink: !color,
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
	const laneOf = (node: FlowNode) => node.lane ?? "main";
	const hasInput = filled.some((col) => col.some((n) => laneOf(n) === "input"));
	const node = (n: FlowNode) => (
		<div
			key={n.id}
			className="flow-node"
			data-flow-id={n.id}
			data-highlight={!!n.highlight}
		>
			{n.body}
		</div>
	);
	return (
		<section className="turn-steps step-flow-scroll" aria-label={label}>
			<div className="step-flow" ref={ref}>
				<svg aria-hidden="true" className="step-flow-lines">
					<g ref={layer} />
				</svg>
				{filled.flatMap((col, c) => {
					const pick = (lane: FlowLane) =>
						col.filter((n) => laneOf(n) === lane);
					const input = pick("input");
					const main = pick("main");
					const side = pick("side");
					// The side lane hangs under its own column's stage, so opening a card
					// elsewhere never pushes it away from the step it branches from.
					return [
						input.length > 0 && (
							<div
								className="flow-cell"
								data-lane="input"
								key={"in-" + input[0].id}
								style={{ gridColumn: c + 1, gridRow: 1 }}
							>
								{input.map(node)}
							</div>
						),
						main.length + side.length > 0 && (
							<div
								className="flow-cell"
								data-lane="main"
								key={"main-" + (main[0] ?? side[0]).id}
								style={{ gridColumn: c + 1, gridRow: hasInput ? 2 : 1 }}
							>
								{main.map(node)}
								{side.length > 0 && (
									<div className="flow-cell" data-lane="side">
										{side.map(node)}
									</div>
								)}
							</div>
						),
					].filter(Boolean);
				})}
			</div>
		</section>
	);
}
