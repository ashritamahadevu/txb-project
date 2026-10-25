import { Platform } from "react-native";

export const colors = {
  bg: "#14110e",
  card: "#241c16",
  line: "#3a3128",
  text: "#f6f0e6",
  muted: "#b4a89a",
  lime: "#dff25a",
  ink: "#17140f",
  coral: "#ff5c3a",
  good: "#9be7a4",
};

export const serif = Platform.select({
  web: "Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif",
  default: "serif",
});

export const sans = Platform.select({
  web: "Avenir Next, Segoe UI, sans-serif",
  default: "sans-serif",
});
