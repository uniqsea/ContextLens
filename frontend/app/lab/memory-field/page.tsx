import { notFound } from "next/navigation";
import MemoryField from "./memory-field";

export const metadata = {
	title: "记忆场 · ContextLens",
	robots: { index: false, follow: false },
};

export default function Page() {
	if (process.env.NODE_ENV !== "development") notFound();
	return <MemoryField />;
}
