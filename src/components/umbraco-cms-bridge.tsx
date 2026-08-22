"use client";

import { useEffect, useRef, useState } from "react";
import { prepareCmsImageUpload } from "@/lib/media/image-upload";

type CmsSession = {
  signedIn: boolean;
  authorized: boolean;
  user?: { email?: string; name?: string };
  capabilities?: { edit?: boolean; publish?: boolean; upload?: boolean };
};

type CmsRevision = { id: string; status?: string };

export type CmsBroker = {
  session(): Promise<CmsSession>;
  adoptSession(sessionToken: string): Promise<CmsSession>;
  login(returnTo: string, options: { forceLogin?: boolean; sameTab: true }): Promise<unknown>;
  request(
    operation: "login-url",
    payload: { forceLogin?: boolean; returnTo: string; sameTab?: boolean },
  ): Promise<{ loginUrl?: string }>;
  content(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  draft(input: Record<string, unknown>): Promise<{ revision: CmsRevision }>;
  publish(input: Record<string, unknown>): Promise<{ revision: CmsRevision }>;
  upload(
    file: File,
    input: { regionId: string; title: string },
  ): Promise<{ assetPath?: string; url?: string }>;
};

export type BridgeOperation =
  | "adopt-session"
  | "content"
  | "draft"
  | "publish"
  | "session"
  | "upload";

type BridgeRequest = {
  type: "olavur-usable-bridge:request";
  requestId: string;
  operation: BridgeOperation;
  payload?: Record<string, unknown>;
};

export function UmbracoCmsBridge({ parentOrigin = "" }: { parentOrigin?: string }) {
  const [session, setSession] = useState<CmsSession>();
  const [error, setError] = useState("");
  const brokerRef = useRef<CmsBroker | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    function receiveAuth(event: Event) {
      const detail = (event as CustomEvent<CmsSession & { broker?: CmsBroker }>).detail;
      if (!detail || detail.broker !== brokerRef.current) return;
      const next = sessionFromAuthEvent(detail);
      setSession(next);
      announce(next, parentOrigin);
    }

    window.addEventListener("usable-cms-broker:auth", receiveAuth);

    async function connect() {
      const broker = window.usableCmsBroker as unknown as CmsBroker | undefined;
      if (!broker) {
        attempts += 1;
        if (attempts < 80) window.setTimeout(connect, 100);
        else setError("The Usable CMS broker could not be loaded.");
        return;
      }

      try {
        const next = await broker.session();
        if (cancelled) return;
        brokerRef.current = broker;
        setSession(next);
        announce(next, parentOrigin);
      } catch (nextError) {
        if (!cancelled) setError(messageFrom(nextError));
      }
    }

    void connect();
    return () => {
      cancelled = true;
      window.removeEventListener("usable-cms-broker:auth", receiveAuth);
    };
  }, [parentOrigin]);

  useEffect(() => {
    async function receive(event: MessageEvent<BridgeRequest>) {
      if (!allowedParentOrigins(parentOrigin).has(event.origin)) return;
      if (event.source !== window.parent) return;
      const message = event.data;
      if (message?.type !== "olavur-usable-bridge:request" || !message.requestId) return;

      try {
        const broker = brokerRef.current;
        if (!broker) throw new Error("The Usable CMS broker is not ready.");
        const result = await performBridgeOperation(
          broker,
          message.operation,
          message.payload || {},
        );
        event.source?.postMessage(
          {
            type: "olavur-usable-bridge:response",
            requestId: message.requestId,
            ok: true,
            result,
          },
          { targetOrigin: event.origin },
        );
        if (message.operation === "session") setSession(result as CmsSession);
      } catch (nextError) {
        event.source?.postMessage(
          {
            type: "olavur-usable-bridge:response",
            requestId: message.requestId,
            ok: false,
            error: messageFrom(nextError),
          },
          { targetOrigin: event.origin },
        );
      }
    }

    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [parentOrigin]);

  async function signIn() {
    setError("");
    try {
      const broker = brokerRef.current;
      if (!broker) throw new Error("The Usable CMS broker is not ready.");
      await openUsableLoginPopup(broker, window.location.href);
    } catch (nextError) {
      setError(messageFrom(nextError));
    }
  }

  if (error) return <BridgeStatus tone="error">{error}</BridgeStatus>;
  if (!session) return <BridgeStatus>Connecting to Usable…</BridgeStatus>;
  if (!session.signedIn) {
    return (
      <BridgeStatus>
        <span>Sign in to save canonical drafts.</span>
        <button type="button" onClick={() => void signIn()}>
          Sign in with Usable
        </button>
      </BridgeStatus>
    );
  }
  if (!session.authorized) {
    return <BridgeStatus tone="error">This Usable account cannot edit this site.</BridgeStatus>;
  }

  return (
    <BridgeStatus tone="ready">
      <span className="dot" />
      Connected as {session.user?.name || session.user?.email || "Usable editor"}
    </BridgeStatus>
  );
}

type LoginPopup = {
  close(): void;
  location: { replace(url: string): void };
};

export async function openUsableLoginPopup(
  broker: CmsBroker,
  returnTo: string,
  openPopup: () => LoginPopup | null = () => {
    const popup = window.open("about:blank", "usableCmsLogin", "popup,width=520,height=720");
    if (!popup) return null;
    return {
      close: () => popup.close(),
      location: { replace: (url) => popup.location.replace(url) },
    };
  },
) {
  const popup = openPopup();
  if (!popup) {
    throw new Error("Allow pop-ups for this Umbraco site, then sign in with Usable again.");
  }

  try {
    const result = await broker.request("login-url", { returnTo, sameTab: false });
    if (!result.loginUrl) throw new Error("Usable did not return a sign-in URL.");
    popup.location.replace(result.loginUrl);
  } catch (error) {
    popup.close();
    throw error;
  }
}

function sessionFromAuthEvent(detail: CmsSession & { broker?: CmsBroker }): CmsSession {
  return {
    signedIn: detail.signedIn,
    authorized: detail.authorized,
    user: detail.user,
    capabilities: detail.capabilities,
  };
}

function announce(session: CmsSession, configuredParent: string) {
  for (const parentOrigin of allowedParentOrigins(configuredParent)) {
    window.parent.postMessage({ type: "olavur-usable-bridge:status", session }, parentOrigin);
  }
}

function allowedParentOrigins(configuredParent: string) {
  const origins = new Set<string>();
  if (configuredParent) {
    try {
      origins.add(new URL(configuredParent).origin);
    } catch {
      // Invalid configuration stays closed rather than broadening postMessage access.
    }
  }
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    origins.add("http://127.0.0.1:5099");
    origins.add("http://localhost:5099");
  }
  return origins;
}

function BridgeStatus({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ready" | "error";
}) {
  return (
    <main className={`bridge bridge-${tone}`}>
      {children}
      <style jsx>{`
        :global(html),
        :global(body) {
          background: transparent !important;
          min-height: 0 !important;
          overflow: hidden;
        }
        :global(body > header),
        :global(body > footer),
        :global(body > script) {
          display: none !important;
        }
        .bridge {
          align-items: center;
          background: #f5f5f7;
          color: #414353;
          display: flex;
          font: 600 13px/1.35 ui-sans-serif, system-ui, sans-serif;
          gap: 9px;
          inset: 0;
          justify-content: flex-start;
          padding: 10px 12px;
          position: fixed;
        }
        .bridge-ready { color: #246c3a; }
        .bridge-error { background: #fff1f0; color: #9f2b24; }
        .dot {
          background: #36a65c;
          border-radius: 50%;
          box-shadow: 0 0 0 3px rgba(54, 166, 92, 0.14);
          height: 8px;
          width: 8px;
        }
        button {
          background: #1b264f;
          border: 0;
          border-radius: 5px;
          color: white;
          cursor: pointer;
          font: inherit;
          margin-left: auto;
          padding: 6px 10px;
        }
      `}</style>
    </main>
  );
}

function messageFrom(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "The Usable CMS request failed.";
}

export async function performBridgeOperation(
  broker: CmsBroker,
  operation: BridgeOperation,
  payload: Record<string, unknown>,
) {
  if (operation === "adopt-session") {
    const sessionToken = typeof payload.sessionToken === "string" ? payload.sessionToken : "";
    return broker.adoptSession(sessionToken);
  }
  if (operation === "session") return broker.session();
  if (operation === "content") return broker.content(payload);
  if (operation === "draft") return broker.draft(payload);
  if (operation === "publish") return broker.publish(payload);

  const file = payload.file;
  const regionId = typeof payload.regionId === "string" ? payload.regionId.trim() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!(file instanceof File)) throw new Error("Choose an image before uploading.");
  if (!regionId) throw new Error("The image field is not registered with Usable CMS.");

  const preparation = await prepareCmsImageUpload(file);
  const uploaded = await broker.upload(preparation.file, {
    regionId,
    title: title || preparation.file.name,
  });
  const url = uploaded.url || absoluteCmsAssetUrl(uploaded.assetPath);
  if (!url) throw new Error("Usable did not return the uploaded asset URL.");

  return {
    ...uploaded,
    url,
    preparation: {
      fileName: preparation.file.name,
      height: preparation.height,
      optimized: preparation.optimized,
      originalBytes: preparation.originalBytes,
      uploadBytes: preparation.uploadBytes,
      width: preparation.width,
    },
  };
}

function absoluteCmsAssetUrl(assetPath?: string) {
  if (!assetPath) return undefined;
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  return new URL(assetPath, "https://cms.usable.dev").toString();
}
