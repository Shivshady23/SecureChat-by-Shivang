import { render, screen } from "@testing-library/react";
import MessageList from "./MessageList";

const baseProps = {
  usersById: {
    self: { _id: "self", name: "Me" },
    other: { _id: "other", name: "Other" }
  },
  currentUserId: "self",
  onDownloadFile: jest.fn(),
  rendered: {},
  isLoading: false,
  onReplyMessage: jest.fn(),
  onDeleteMessage: jest.fn(),
  onEditMessage: jest.fn(),
  onReactMessage: jest.fn(),
  onToggleSelectMessage: jest.fn()
};

describe("MessageList", () => {
  test("renders image message thumbnail", () => {
    render(
      <MessageList
        {...baseProps}
        messages={[
          {
            _id: "m1",
            chatId: "c1",
            senderId: "self",
            type: "image",
            fileUrl: "/uploads/test-image.png",
            fileName: "test-image.png",
            mimeType: "image/png",
            createdAt: new Date().toISOString()
          }
        ]}
      />
    );

    expect(screen.getByAltText("test-image.png")).toBeInTheDocument();
  });

  test("renders audio file as generic file message without inline player", () => {
    const { container } = render(
      <MessageList
        {...baseProps}
        messages={[
          {
            _id: "m2",
            chatId: "c1",
            senderId: "self",
            type: "file",
            fileUrl: "/uploads/voice.webm",
            fileName: "voice.webm",
            mimeType: "audio/webm",
            size: 2048,
            fileSize: 2048,
            createdAt: new Date().toISOString()
          }
        ]}
      />
    );

    expect(container.querySelector("audio.message-audio-player")).not.toBeInTheDocument();
    expect(screen.getByText(/voice\.webm/i)).toBeInTheDocument();
    expect(container.querySelector("button.file-button")).toBeInTheDocument();
  });
});
