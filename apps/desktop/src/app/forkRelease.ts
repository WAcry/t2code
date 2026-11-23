export const FORK_APP_ID = "io.github.wacry.t3code";
export const FORK_APP_PACKAGE_NAME = "t3code-fork";
export const FORK_APP_NAME = "T3 Code Fork";
export const FORK_HOME_DIRECTORY = ".t3-wacry";

export function isForkDesktopVersion(version: string): boolean {
  return /-fork\.\d{8}\.\d+\.\d+$/.test(version);
}
