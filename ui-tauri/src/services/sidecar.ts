/**
 * Sidecar management for the C++ backend process.
 *
 * In production, Tauri launches the backend binary as a sidecar.
 * During development, the backend is expected to be running independently.
 *
 * Integration point: When the C++ backend is built and bundled,
 * configure src-tauri/tauri.conf.json with the sidecar binary path.
 *
 * See: https://v2.tauri.app/develop/sidecar/
 */

// TODO: Uncomment when @tauri-apps/plugin-shell is configured in Cargo.toml
// import { Command } from "@tauri-apps/plugin-shell";

let backendRunning = false;

export async function startBackend(): Promise<void> {
  if (backendRunning) return;

  // TODO: Replace with actual sidecar launch when backend binary is ready
  // const command = Command.sidecar("binaries/p2p-backend");
  // command.on("close", (data) => {
  //   console.log(`[Sidecar] Backend exited with code ${data.code}`);
  //   backendRunning = false;
  // });
  // command.on("error", (error) => {
  //   console.error(`[Sidecar] Error: ${error}`);
  // });
  // command.stdout.on("data", (line) => console.log(`[Backend] ${line}`));
  // command.stderr.on("data", (line) => console.error(`[Backend] ${line}`));
  // await command.spawn();

  backendRunning = true;
  console.log("[Sidecar] Backend start requested (stub — run backend manually during dev)");
}

export async function stopBackend(): Promise<void> {
  // TODO: Kill the sidecar process on app close
  backendRunning = false;
  console.log("[Sidecar] Backend stop requested");
}

export function isBackendRunning(): boolean {
  return backendRunning;
}
