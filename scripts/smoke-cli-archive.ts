#!/usr/bin/env node
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as NetService from "@t3tools/shared/Net";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { FORK_CLI_RELEASES_PAGE_URL } from "@t3tools/shared/cliRelease";
import { windowsSystemTar } from "./lib/windows-tar.ts";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

export class CliArchiveSmokeError extends Schema.TaggedError<CliArchiveSmokeError>()(
  "CliArchiveSmokeError",
  { step: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `CLI archive smoke test failed while ${this.step}: ${this.detail}`;
  }
}

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const runExecutable = Effect.fn("runExecutable")(function* (
  executable: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(executable, args, {
      cwd,
      // Isolate system Node and inherited launcher context from the archive smoke check.
      env: { PATH: "", HOME: cwd, USERPROFILE: cwd, TMPDIR: cwd, TEMP: cwd },
      extendEnv: false,
    }),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collect(child.stdout), collect(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  );
  return { stdout, stderr, exitCode };
});

const makeTelemetryReceiver = Effect.fn("makeTelemetryReceiver")(function* () {
  const services = yield* Layer.build(NodeHttpServer.layerTest);
  const server = Context.get(services, HttpServer.HttpServer);
  const requests: string[] = [];
  yield* server.serve(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.method === "POST") requests.push(request.url);
      return HttpServerResponse.empty({ status: 200 });
    }),
  );
  return { url: HttpServer.formatAddress(server.address), requests };
});

const disabledTelemetryCapabilities = Schema.Struct({
  capabilities: Schema.Struct({
    otlpEndpointCheck: Schema.Literal(false),
    agentFeedback: Schema.Literal(false),
  }),
});

const smokeCliArchive = Effect.fn("smokeCliArchive")(function* (input: {
  readonly archive: string;
  readonly expectVersion: string;
  readonly expectTelemetryDisabled: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scratch = yield* fs.makeTempDirectory({ prefix: "t3-cli-smoke-" });
  // Windows can briefly retain executable locks; cleanup retries but must not fail a successful smoke check.
  yield* Effect.addFinalizer(() =>
    fs.remove(scratch, { recursive: true }).pipe(
      Effect.retry({ times: 10, schedule: Schedule.spaced("500 millis") }),
      Effect.catch((error) =>
        Effect.logWarning(`[cli-smoke] could not remove ${scratch}: ${error.message}`),
      ),
    ),
  );

  // Windows bsdtar reads zip; Git Bash's GNU tar does not.
  const tar = platform === "win32" ? windowsSystemTar() : "tar";
  const extract = yield* spawner
    .spawn(ChildProcess.make(tar, ["-xf", input.archive, "-C", scratch]))
    .pipe(Effect.flatMap((child) => child.exitCode));
  if (Number(extract) !== 0) {
    return yield* new CliArchiveSmokeError({
      step: "extracting the archive",
      detail: `tar exited with ${String(extract)}`,
    });
  }
  const [root] = yield* fs.readDirectory(scratch);
  if (root === undefined) {
    return yield* new CliArchiveSmokeError({
      step: "extracting the archive",
      detail: "the archive was empty",
    });
  }
  const contentDir = path.join(scratch, root);
  const executable = path.join(contentDir, platform === "win32" ? "t3.exe" : "t3");
  const bundledLibatomic = path.join(contentDir, "lib/libatomic.so.1");
  for (const required of [
    executable,
    path.join(contentDir, "client/index.html"),
    ...(platform === "linux" ? [bundledLibatomic, `${bundledLibatomic}.LICENSE`] : []),
  ]) {
    if (!(yield* fs.exists(required))) {
      return yield* new CliArchiveSmokeError({
        step: "checking the archive layout",
        detail: `missing ${path.relative(contentDir, required)}`,
      });
    }
  }

  // The runner has libatomic installed; fresh Ubuntu servers do not.
  if (platform === "linux") {
    const ldd = yield* spawner.string(ChildProcess.make("ldd", [executable]));
    // Older glibc prints the path as given, newer prints it resolved; compare both resolved.
    const loaded = /libatomic\.so\.1 => (\/.*) \(0x[0-9a-f]+\)/.exec(ldd)?.[1];
    if (
      loaded === undefined ||
      (yield* fs.realPath(loaded)) !== (yield* fs.realPath(bundledLibatomic))
    ) {
      return yield* new CliArchiveSmokeError({
        step: "checking that t3 loads the bundled libatomic",
        detail: ldd,
      });
    }
  }

  const version = yield* runExecutable(executable, ["--version"], contentDir);
  if (version.exitCode !== 0 || version.stdout.trim() !== `t3 v${input.expectVersion}`) {
    return yield* new CliArchiveSmokeError({
      step: "running --version",
      detail: `exit ${String(version.exitCode)}\n${version.stdout}${version.stderr}`,
    });
  }

  // The service launcher loads outside the embedded CLI; without T3CODE_HOME it exits right away.
  const launcher = yield* runExecutable(executable, ["__service-launcher"], contentDir);
  if (launcher.exitCode !== 1 || !launcher.stderr.includes("T3CODE_HOME is required")) {
    return yield* new CliArchiveSmokeError({
      step: "running __service-launcher",
      detail: `exit ${String(launcher.exitCode)}\n${launcher.stdout}${launcher.stderr}`,
    });
  }
  if (input.expectTelemetryDisabled) {
    const update = yield* runExecutable(executable, ["update"], contentDir);
    if (
      update.exitCode === 0 ||
      !`${update.stdout}${update.stderr}`.includes(FORK_CLI_RELEASES_PAGE_URL)
    ) {
      return yield* new CliArchiveSmokeError({
        step: "checking that updates stay on the fork",
        detail: `exit ${String(update.exitCode)}\n${update.stdout}${update.stderr}`,
      });
    }
  }

  const net = yield* NetService.NetService;
  const port = yield* net.findAvailablePort(47700);
  const home = path.join(scratch, "home");
  const receiver = input.expectTelemetryDisabled ? yield* makeTelemetryReceiver() : undefined;
  const httpClient = yield* HttpClient.HttpClient;
  if (receiver && (yield* httpClient.get(receiver.url)).status !== 200) {
    return yield* new CliArchiveSmokeError({
      step: "starting the loopback telemetry receiver",
      detail: "no 200 from the receiver",
    });
  }
  const server = yield* spawner.spawn(
    ChildProcess.make(
      executable,
      ["serve", "--host", "127.0.0.1", "--port", String(port), "--no-browser"],
      {
        cwd: contentDir,
        env: {
          PATH: "",
          HOME: home,
          USERPROFILE: home,
          TMPDIR: scratch,
          TEMP: scratch,
          T3CODE_HOME: home,
          ...(receiver
            ? {
                T3CODE_TELEMETRY_ENABLED: "true",
                T3CODE_POSTHOG_HOST: receiver.url,
                T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: "1",
                T3CODE_OTEL_SDK_DISABLED: "false",
                OTEL_SDK_DISABLED: "false",
                OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url,
                OTEL_METRIC_EXPORT_INTERVAL: "1000",
                OTEL_BSP_SCHEDULE_DELAY: "1000",
                OTEL_BLRP_SCHEDULE_DELAY: "1000",
              }
            : { T3CODE_TELEMETRY_ENABLED: "false" }),
        },
        extendEnv: false,
      },
    ),
  );
  const output = yield* Effect.forkScoped(
    Effect.all([collect(server.stdout), collect(server.stderr)]),
  );
  // Probes can hang during server initialization; bound each request as SSH readiness does.
  const probe = httpClient.execute(HttpClientRequest.get(`http://127.0.0.1:${String(port)}/`)).pipe(
    Effect.map((response) => response.status === 200),
    Effect.timeout(Duration.seconds(2)),
    Effect.orElseSucceed(() => false),
  );
  const pollUntilReady = Effect.gen(function* () {
    while (!(yield* probe)) {
      yield* Effect.sleep(Duration.millis(250));
    }
    return true;
  });
  let ready = yield* pollUntilReady.pipe(
    Effect.timeout(Duration.seconds(30)),
    Effect.orElseSucceed(() => false),
  );
  if (ready && receiver) {
    // Cover the product event buffer's ten-second periodic flush as well as exporter startup.
    yield* Effect.sleep(Duration.seconds(12));
    ready = yield* probe;
  }
  const telemetryCapabilitiesDisabled =
    !receiver ||
    (ready &&
      (yield* httpClient.get(`http://127.0.0.1:${String(port)}/.well-known/t3/environment`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(disabledTelemetryCapabilities)),
        Effect.as(true),
        Effect.timeout(Duration.seconds(2)),
        Effect.orElseSucceed(() => false),
      )));
  yield* server.kill({ killSignal: "SIGTERM" }).pipe(Effect.ignore);
  yield* server.exitCode.pipe(Effect.timeout(Duration.seconds(10)), Effect.ignore);
  const [stdout, stderr] = yield* Fiber.join(output).pipe(
    Effect.timeout(Duration.seconds(5)),
    Effect.orElseSucceed(() => ["", ""] as const),
  );
  if (!ready) {
    return yield* new CliArchiveSmokeError({
      step: "serving from the extracted archive",
      detail: `no 200 from / within 30s\n${stdout}${stderr}`,
    });
  }
  if (receiver) {
    if (!telemetryCapabilitiesDisabled) {
      return yield* new CliArchiveSmokeError({
        step: "checking advertised telemetry capabilities",
        detail: "the server did not report feedback and OTLP endpoint checks as disabled",
      });
    }
    if (receiver.requests.length > 0) {
      return yield* new CliArchiveSmokeError({
        step: "checking forced telemetry disablement",
        detail: `unexpected requests to the loopback telemetry receiver: ${receiver.requests.join(", ")}`,
      });
    }
    yield* Effect.log("[cli-smoke] No telemetry sent with product events and OTLP configured.");
  }
  yield* Effect.log(
    `[cli-smoke] ${root}: --version and __service-launcher passed, and serve answered on ${String(port)}.`,
  );
});

const command = Command.make(
  "smoke-cli-archive",
  {
    archive: Flag.String("archive"),
    expectVersion: Flag.String("expect-version"),
    expectTelemetryDisabled: Flag.Boolean("expect-telemetry-disabled"),
  },
  (input) => smokeCliArchive(input).pipe(Effect.scoped),
).pipe(Command.withDescription("Extract a CLI archive and run its executable."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Logger.layer([Logger.consolePretty()]),
        NodeServices.layer,
        NetService.layer,
        FetchHttpClient.layer,
      ),
    ),
    NodeRuntime.runMain,
  );
}
