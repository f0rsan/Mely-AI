import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "./App";

test("shows the startup placeholder before backend wiring exists", () => {
  render(<App />);

  expect(screen.getByText("正在连接后端...")).toBeInTheDocument();
});
