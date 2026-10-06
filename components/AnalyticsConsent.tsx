"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";

type Choice = "accepted" | "rejected" | null;
type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

const storageKey = "userv-analytics-consent-v1";
const sixMonths = 180 * 24 * 60 * 60 * 1000;
const consentEvent = "userv-analytics-consent-change";
let memoryChoice: Choice | undefined;

function readChoice(): Choice {
    if (memoryChoice !== undefined) return memoryChoice;
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { value?: Choice; at?: number } | null;
        const valid = stored && typeof stored.at === "number" && Date.now() - stored.at < sixMonths;
        return valid && (stored.value === "accepted" || stored.value === "rejected") ? stored.value : null;
    } catch {
        return null;
    }
}

function subscribe(callback: () => void) {
    const onStorage = () => { memoryChoice = undefined; callback(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(consentEvent, callback);
    return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(consentEvent, callback);
    };
}

function removeAnalyticsCookies() {
    for (const part of document.cookie.split(";")) {
        const name = part.split("=")[0]?.trim();
        if (!name || !/^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/.test(name)) continue;
        const domains = ["", `; Domain=${location.hostname}`, "; Domain=.userv.info"];
        for (const domain of domains) {
            document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
        }
    }
}

export default function AnalyticsConsent({ gaId, privacyHref }: { gaId?: string; privacyHref?: string }) {
    const choice = useSyncExternalStore(subscribe, readChoice, () => "loading");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [scriptReady, setScriptReady] = useState(false);

    useEffect(() => {
        if (choice !== "accepted" || !gaId || scriptReady) return;
        const target = window as GtagWindow;
        target.dataLayer = target.dataLayer ?? [];
        target.gtag = (...args: unknown[]) => target.dataLayer?.push(args);
        target.gtag("consent", "default", {
            analytics_storage: "denied",
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
        });
        target.gtag("consent", "update", {
            analytics_storage: "granted",
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
        });
        let active = true;
        queueMicrotask(() => { if (active) setScriptReady(true); });
        return () => { active = false; };
    }, [choice, gaId, scriptReady]);

    function save(value: Exclude<Choice, null>) {
        try {
            localStorage.setItem(storageKey, JSON.stringify({ value, at: Date.now() }));
        } catch {
            // A blocked storage still permits a choice for this page view.
        }
        memoryChoice = value;
        if (value === "rejected") {
            (window as GtagWindow).gtag?.("consent", "update", {
                analytics_storage: "denied",
                ad_storage: "denied",
                ad_user_data: "denied",
                ad_personalization: "denied",
            });
            removeAnalyticsCookies();
            if (scriptReady) {
                window.location.reload();
                return;
            }
        }
        window.dispatchEvent(new Event(consentEvent));
        setSettingsOpen(false);
    }

    if (!gaId || choice === "loading") return null;

    return (
        <>
            {scriptReady && <GoogleAnalytics gaId={gaId} />}
            {(choice === null || settingsOpen) ? (
                <div role="dialog" aria-label="Choix des cookies" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl">
                    <h2 className="text-base font-semibold">Mesure d’audience</h2>
                    <p className="mt-2 text-sm text-slate-600">Avec votre accord, nous utilisons Google Analytics pour mesurer la fréquentation. Vous pouvez refuser sans perdre l’accès au site. {privacyHref && <>Consultez notre <a href={privacyHref} className="underline">politique de confidentialité</a>.</>}</p>
                    <div className="mt-4 flex gap-3">
                        <button type="button" onClick={() => save("rejected")} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">Refuser</button>
                        <button type="button" onClick={() => save("accepted")} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">Accepter</button>
                    </div>
                </div>
            ) : (
                <button type="button" onClick={() => setSettingsOpen(true)} className="fixed bottom-3 left-3 z-40 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">Cookies</button>
            )}
        </>
    );
}
