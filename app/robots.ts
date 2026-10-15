import type { MetadataRoute } from "next";

// A real robots.txt: without it the auth redirect served crawlers the sign-in HTML instead.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
