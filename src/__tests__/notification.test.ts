import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isPermissionGrantedMock,
  requestPermissionMock,
  sendNotificationMock
} = vi.hoisted(() => ({
  isPermissionGrantedMock: vi.fn(),
  requestPermissionMock: vi.fn(),
  sendNotificationMock: vi.fn()
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: isPermissionGrantedMock,
  requestPermission: requestPermissionMock,
  sendNotification: sendNotificationMock
}));

import { sendPromptReadyNotification } from "../terminal/notify";

describe("sendPromptReadyNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notification when permission is granted", async () => {
    isPermissionGrantedMock.mockResolvedValue(true);

    await sendPromptReadyNotification();

    expect(sendNotificationMock).toHaveBeenCalledWith({
      title: "AI agent",
      body: "Ready for your next prompt."
    });
  });

  it("does not send notification when permission is denied", async () => {
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue("denied");

    await sendPromptReadyNotification();

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
