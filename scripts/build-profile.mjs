import path from "node:path";

// Local engineering budget for the complete Dashell learning bundle. Static
// language/CMap packing reduces it from 7 MB; this is not a Sync size claim.
export const RELEASE_ASSET_BUDGET_BYTES = 5_600_000;

export function assertReleaseAssetSize(name, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > RELEASE_ASSET_BUDGET_BYTES) {
    throw new Error(`${name} must be between 1 and ${RELEASE_ASSET_BUDGET_BYTES} bytes: ${bytes} bytes`);
  }
}

export function buildProfile(name = "standard", root = process.cwd()) {
  if (!["standard", "community"].includes(name)) throw new Error(`Unknown build profile: ${name}`);
  return {
    name,
    outputDir: name === "community" ? path.join(root, "dist", "community") : root,
    plugins: [],
  };
}
