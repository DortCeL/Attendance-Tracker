import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("stats", "routes/stats.tsx"),
  route("courses/:id", "routes/course.tsx"),
  route("routine", "routes/routine.tsx"),
  route("routine/import", "routes/import.tsx"),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
