import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export async function sendPromptReadyNotification(): Promise<void> {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }

  if (!permissionGranted) {
    return;
  }

  await sendNotification({
    title: "AI agent",
    body: "Ready for your next prompt."
  });
}
