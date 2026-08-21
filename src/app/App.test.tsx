import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the six primary areas", () => {
  render(<App />);
  for (const label of ["资料库", "角色构筑", "配队实验室", "Agent 推荐", "社区配队", "账号与版本"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
});

test("moves focus to main content without changing the hash route", () => {
  window.location.hash = "#/agent";
  render(<App />);
  const main = screen.getByRole("main");

  screen.getByRole("link", { name: "跳到主要内容" }).click();

  expect(main).toHaveFocus();
  expect(window.location.hash).toBe("#/agent");
});
