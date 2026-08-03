/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForFast } from "../../test-helpers/wait-for.ts";
import { createContext, mountPage } from "./custodian-page.test-harness.ts";
import {
  readCustodianRecoveryForClient,
  reconcileCustodianRecoveryForClient,
} from "./custodian-recovery.ts";

const gatewayUrl = "ws://gateway.test/control";
const recoveryScope = "principal-a";
const recoveryClient = { recoveryScope, recoveryScopeReady: true } as never;

describe("Custodian wizard reload recovery", () => {
  afterEach(() => {
    document.body.replaceChildren();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("restores the sanitized active step and continues the same live session", async () => {
    let cancelled = false;
    let freshChatCount = 0;
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "openclaw.chat.history") {
        if (params.sessionId === "live-wizard" && !cancelled) {
          return {
            turns: [
              { role: "user", text: "connect twitch", at: 1 },
              { role: "assistant", text: "Enter the secret.", at: 2 },
            ],
            activeWizard: {
              sessionId: "live-wizard",
              step: {
                id: "secret",
                type: "text",
                message: "Twitch client secret",
                sensitive: true,
              },
            },
          };
        }
        return { turns: [] };
      }
      if (method !== "openclaw.chat") {
        throw new Error(`unexpected method ${method}`);
      }
      if (params.wizardCancel) {
        cancelled = true;
        return {
          sessionId: "live-wizard",
          reply: "Twitch setup cancelled.",
          action: "none",
        };
      }
      freshChatCount += 1;
      return freshChatCount === 1
        ? {
            sessionId: "live-wizard",
            reply: "Enter the secret.",
            action: "none",
            sensitive: true,
            wizardInputPending: true,
            step: {
              id: "secret",
              type: "text",
              message: "Twitch client secret",
              sensitive: true,
            },
          }
        : { sessionId: "fresh-session", reply: "Fresh session ready.", action: "none" };
    });
    const { context } = createContext(request, ["openclaw.chat", "openclaw.chat.history"], {
      recoveryScope,
    });
    const first = await mountPage(context);
    await waitForFast(() =>
      expect(first.page.querySelector(".custodian__wizard-step")).not.toBeNull(),
    );
    expect(readCustodianRecoveryForClient(recoveryClient, gatewayUrl)).toEqual({
      sessionId: "live-wizard",
    });

    first.provider.remove();
    const second = await mountPage(context);
    const recoveredInput = await waitForFast(() => {
      const input = second.page.querySelector<HTMLInputElement>(
        '.custodian__wizard-step input[type="password"]',
      );
      expect(input).not.toBeNull();
      return input!;
    });
    expect(recoveredInput.value).toBe("");
    expect(second.page.textContent).toContain("Enter the secret.");
    expect(request.mock.calls.filter(([method]) => method === "openclaw.chat")).toHaveLength(1);

    second.page.querySelector<HTMLButtonElement>(".custodian__wizard-cancel")!.click();
    await waitForFast(() => expect(second.page.textContent).toContain("Twitch setup cancelled."));
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
      sessionId: "live-wizard",
      wizardCancel: { stepId: "secret" },
    });
    expect(readCustodianRecoveryForClient(recoveryClient, gatewayUrl)).toBeNull();

    second.provider.remove();
    const third = await mountPage(context);
    await waitForFast(() => expect(third.page.textContent).toContain("Fresh session ready."));
    expect(third.page.querySelector(".custodian__wizard-step")).toBeNull();
  });

  it("waits for the authenticated recovery scope before starting a fresh session", async () => {
    reconcileCustodianRecoveryForClient(
      recoveryClient,
      gatewayUrl,
      {
        sessionId: "delayed-scope-wizard",
        reply: "Enter the secret.",
        action: "none",
        wizardInputPending: true,
        step: {
          id: "secret",
          type: "text",
          message: "Twitch client secret",
          sensitive: true,
        },
      },
      "delayed-scope-wizard",
    );
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "openclaw.chat.history") {
        expect(params.sessionId).toBe("delayed-scope-wizard");
        return {
          turns: [{ role: "assistant", text: "Enter the secret.", at: 1 }],
          activeWizard: {
            sessionId: "delayed-scope-wizard",
            step: {
              id: "secret",
              type: "text",
              message: "Twitch client secret",
              sensitive: true,
            },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const harness = createContext(request, ["openclaw.chat", "openclaw.chat.history"], {
      recoveryScope,
      recoveryScopeReady: false,
    });
    const mounted = await mountPage(harness.context);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();

    harness.setRecoveryScopeReady(true);
    const recoveredInput = await waitForFast(() => {
      const input = mounted.page.querySelector<HTMLInputElement>(
        '.custodian__wizard-step input[type="password"]',
      );
      expect(input).not.toBeNull();
      return input!;
    });
    expect(recoveredInput.value).toBe("");
    expect(request.mock.calls.map(([method]) => method)).toEqual(["openclaw.chat.history"]);
  });
});
