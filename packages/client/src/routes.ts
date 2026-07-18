import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("App.tsx", [
    index("features/library/Library.tsx"),
    route("search", "features/search/Search.tsx"),
    route("games/:slug", "features/detail/Detail.tsx"),
    route("*", "catch-all.tsx"),
  ]),
] satisfies RouteConfig;
