import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageTransition } from "@/components/page-transition";

describe("PageTransition", () => {
  it("keeps route content visible while children change", () => {
    const { container, rerender } = render(
      <PageTransition>
        <h1>Document overview</h1>
      </PageTransition>,
    );

    rerender(
      <PageTransition>
        <h1>Parsed content</h1>
      </PageTransition>,
    );

    expect(screen.getByRole("heading", { name: "Parsed content" })).toBeVisible();
    expect(container.firstElementChild).not.toHaveAttribute("style");
  });
});
