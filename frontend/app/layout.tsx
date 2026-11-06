import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { SessionProvider } from "@/components/lens/session-tabs";
import { ThemeProvider } from "@/hooks/use-theme";
import { htmlLang } from "@/i18n/config";
import "./globals.css";
import "./lens.css";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("meta");
	return { title: "ContextLens", description: t("description") };
}

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const locale = await getLocale();
	return (
		<html
			lang={htmlLang(locale)}
			className={`${inter.variable} ${geistMono.variable}`}
			suppressHydrationWarning
		>
			<body className="antialiased">
				<NextIntlClientProvider>
					<ThemeProvider>
						<SessionProvider>{children}</SessionProvider>
					</ThemeProvider>
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
