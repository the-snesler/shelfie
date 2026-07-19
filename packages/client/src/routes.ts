import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  layout("App.tsx", [
    index("features/library/Library.tsx"),
    route("search", "features/search/Search.tsx"),
    route("games/:slug", "features/detail/Detail.tsx"),
    route("movies/:id", "features/detail/MovieDetail.tsx"),
    route("tv/:id", "features/detail/TvDetail.tsx"),
    route("books/:id", "features/detail/BookDetail.tsx"),
    route("*", "catch-all.tsx"),
  ]),
] satisfies RouteConfig;
