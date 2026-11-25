import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { withRelayClientTracing } from "@t3tools/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
// Load the runtime's module graph once at collection, outside the per-test timeout;
// each case re-evaluates it from that cache after vi.resetModules().
import "./runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web runtime relay telemetry policy", () => {
  it.each([
    {
      surface: "desktop opt-out",
      desktopBridge: { getRelayTelemetryEnabled: () => false, getAppBranding: () => null },
    },
    {
      surface: "desktop opt-in",
      desktopBridge: { getRelayTelemetryEnabled: () => true, getAppBranding: () => null },
    },
    {
      surface: "ordinary browser",
      desktopBridge: undefined,
    },
  ])("blocks relay export from $surface", async ({ desktopBridge }) => {
    vi.resetModules();
    vi.stubEnv("T3CODE_TELEMETRY_ENABLED", "true");
    vi.stubEnv("T3CODE_OTEL_SDK_DISABLED", "false");
    vi.stubEnv("OTEL_SDK_DISABLED", "false");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://telemetry.example.test/v1/traces");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "relay-test");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "test-token");
    // The runtime graph loads stores that register page lifecycle listeners.
    vi.stubGlobal("window", { desktopBridge, addEventListener: vi.fn() });
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchFn);
    // Re-import after setting runtime policy: static initialization creates the exporter layer.
    const { runtime: freshRuntime } = await import("./runtime");
    const { configureClientTracing } = await import("../observability/clientTracing");
    const { hasDelegate, setDelegate } = await import("../observability/clientTracer");
    const userSpans: Array<string> = [];

    try {
      await configureClientTracing();
      expect(hasDelegate()).toBe(false);

      expect(
        await freshRuntime.runPromise(
          Effect.succeed("relay operation completed").pipe(
            Effect.withSpan("relay.first-operation"),
            withRelayClientTracing,
          ),
        ),
      ).toBe("relay operation completed");

      setDelegate(
        Tracer.make({
          span(options) {
            userSpans.push(options.name);
            return new Tracer.NativeSpan(options);
          },
        }),
      );
      await freshRuntime.runPromise(Effect.void.pipe(Effect.withSpan("user.work")));
      expect(userSpans).toEqual(["user.work"]);
    } finally {
      setDelegate(null);
      // Closing the runtime flushes the exporter without waiting for its batch timer.
      await freshRuntime.dispose();
    }

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
