import { fireEvent, render, screen } from "@testing-library/react";
import MessageInput from "./MessageInput";

jest.mock("./EmojiPickerPanel", () => function MockEmojiPickerPanel() {
  return null;
});

function renderInput(overrides = {}) {
  const props = {
    onSendText: jest.fn(),
    onSendFile: jest.fn(),
    onSaveEdit: jest.fn(),
    onTyping: jest.fn(),
    onCancelReply: jest.fn(),
    onCancelEdit: jest.fn(),
    ...overrides
  };

  const view = render(<MessageInput {...props} />);
  return { ...view, props };
}

describe("MessageInput", () => {
  test("rejects invalid file selected through image picker", async () => {
    const { container } = renderInput();
    const imageInput = container.querySelector('input[data-upload-type="image"]');
    expect(imageInput).toBeInTheDocument();

    const invalidFile = new File(["fake"], "not-image.pdf", { type: "application/pdf" });
    fireEvent.change(imageInput, { target: { files: [invalidFile] } });

    expect(
      await screen.findByText(/Only jpg, jpeg, png, webp and gif images are allowed/i)
    ).toBeInTheDocument();
  });

  test("sends selected image file with upload type", async () => {
    const { container, props } = renderInput();
    const imageInput = container.querySelector('input[data-upload-type="image"]');
    const validFile = new File(["fake"], "photo.png", { type: "image/png" });

    fireEvent.change(imageInput, { target: { files: [validFile] } });
    const sendButton = await screen.findByRole("button", { name: /^send$/i });
    fireEvent.click(sendButton);

    expect(props.onSendFile).toHaveBeenCalledTimes(1);
    expect(props.onSendFile.mock.calls[0][0]).toBe(validFile);
    expect(props.onSendFile.mock.calls[0][1]).toEqual({ uploadType: "image" });
  });
});
