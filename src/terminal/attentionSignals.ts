import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

import { sendPromptReadyNotification } from "./notify";

function getSafeCurrentWindow() {
  try {
    return getCurrentWindow();
  } catch (error) {
    console.warn("Unable to access current Tauri window", error);
    return null;
  }
}

export async function syncAttentionBadgeCount(unreadCount: number): Promise<void> {
  const appWindow = getSafeCurrentWindow();
  if (!appWindow) {
    return;
  }
  try {
    await appWindow.setBadgeCount(unreadCount > 0 ? unreadCount : undefined);
  } catch (error) {
    console.warn("Unable to set badge count", error);
  }
}

export async function signalAttention(unreadCount: number, withNotification: boolean): Promise<void> {
  const appWindow = getSafeCurrentWindow();
  if (!appWindow) {
    return;
  }

  try {
    await appWindow.requestUserAttention(UserAttentionType.Informational);
  } catch (error) {
    console.warn("Unable to request user attention", error);
  }

  await syncAttentionBadgeCount(unreadCount);

  if (!withNotification) {
    return;
  }

  try {
    await sendPromptReadyNotification();
  } catch (error) {
    console.warn("Unable to send prompt-ready notification", error);
  }
}
