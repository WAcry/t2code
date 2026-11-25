#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { APP_ICONS, appIconFileName } from "@t3tools/shared/appIcons";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Argument, Command, Flag } from "effect/cli";
import {
  resolveWebAssetBrandForChannel,
  resolveWebIconOverrides,
  WEB_ASSET_CHANNELS,
  type WebAssetBrand,
} from "./lib/brand-assets.ts";

const WEB_ASSET_BRANDS = [
  "development",
  "nightly",
  "production",
  "t2code",
] as const satisfies ReadonlyArray<WebAssetBrand>;

export const applyWebBrandAssets = Effect.fn("applyWebBrandAssets")(function* (
  brand: WebAssetBrand,
  targetDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const target = path.resolve(repoRoot, targetDirectory);

  yield* Effect.forEach(
    resolveWebIconOverrides(brand, target),
    (override) =>
      fs.copyFile(path.join(repoRoot, override.sourceRelativePath), override.targetRelativePath),
    { concurrency: "unbounded" },
  );

  if (brand === "t2code") {
    const iconDirectory = path.join(target, "app-icons");
    yield* fs.makeDirectory(iconDirectory, { recursive: true });
    // Keep stored icon IDs working without distributing the upstream artwork.
    yield* Effect.forEach(
      APP_ICONS,
      ({ id }) =>
        Effect.forEach(["macos", "universal", "favicon"] as const, (variant) =>
          fs.copyFile(
            path.join(
              repoRoot,
              "assets/t2code",
              variant === "favicon" ? "favicon-32x32.png" : "icon-512x512.png",
            ),
            path.join(iconDirectory, appIconFileName(id, variant)),
          ),
        ),
      { concurrency: "unbounded" },
    );

    const manifestPath = path.join(target, "manifest.webmanifest");
    if (yield* fs.exists(manifestPath)) {
      const manifest = yield* fs.readFileString(manifestPath);
      yield* fs.writeFileString(
        manifestPath,
        manifest.replace(/("(?:name|short_name)"\s*:\s*)"T3 Code"/g, '$1"t2code"'),
      );
    }
  }
});

export const applyWebBrandAssetsCommand = Command.make(
  "apply-web-brand-assets",
  {
    brand: Argument.Literals("brand", WEB_ASSET_BRANDS).pipe(
      Argument.withDescription("Asset brand to copy into the hosted web output directory."),
      Argument.optional,
    ),
    channel: Flag.Literals("channel", WEB_ASSET_CHANNELS).pipe(
      Flag.withDescription("Hosted release channel to map to a web asset brand."),
      Flag.optional,
    ),
    targetDirectory: Argument.String("target-directory").pipe(
      Argument.withDescription("Output directory that contains the hosted web build assets."),
      Argument.optional,
    ),
  },
  ({ brand, channel, targetDirectory }) =>
    applyWebBrandAssets(
      Option.getOrElse(brand, () =>
        Option.match(channel, {
          onNone: () => "production" as const,
          onSome: resolveWebAssetBrandForChannel,
        }),
      ),
      Option.getOrElse(targetDirectory, () => "apps/web/dist"),
    ),
).pipe(Command.withDescription("Copy web brand assets into a built hosted web app."));

if (import.meta.main) {
  Command.run(applyWebBrandAssetsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
