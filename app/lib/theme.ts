import type { Theme } from "./types";

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#09090b" : "#4f46e5");
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Private mode / storage disabled: theme still applies for this session.
  }
}
