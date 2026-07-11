import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "./Tabs";

function TestTabs({
  initialTab = "one",
  children,
}: {
  initialTab?: string;
  children?: ReactNode;
}) {
  const [value, setValue] = useState(initialTab);

  return (
    <Tabs value={value} onChange={setValue}>
      <TabList>
        <Tab value="one">One</Tab>
        <Tab value="two" badge="•">
          Two
        </Tab>
      </TabList>
      {children ?? (
        <>
          <TabPanel value="one">Panel one</TabPanel>
          <TabPanel value="two">Panel two</TabPanel>
        </>
      )}
    </Tabs>
  );
}

describe("Tabs", () => {
  it("shows only the selected panel", () => {
    render(<TestTabs initialTab="one" />);

    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel one");
    expect(screen.queryByText("Panel two")).not.toBeInTheDocument();
  });

  it("switches panels when a tab is clicked", () => {
    render(<TestTabs initialTab="one" />);

    fireEvent.click(screen.getByRole("tab", { name: /two/i }));

    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel two");
    expect(screen.queryByText("Panel one")).not.toBeInTheDocument();
  });

  it("moves selection with arrow keys", () => {
    render(<TestTabs initialTab="one" />);

    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: /two/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel two");
  });

  it("renders optional tab badges", () => {
    render(<TestTabs initialTab="two" />);

    expect(screen.getByText("•")).toBeInTheDocument();
  });

  it("renders underline variant with a sliding indicator", () => {
    render(
      <Tabs value="one" onChange={() => {}} variant="underline">
        <TabList>
          <Tab value="one">One</Tab>
          <Tab value="two">Two</Tab>
        </TabList>
      </Tabs>,
    );

    const tablist = screen.getByRole("tablist");
    expect(tablist).toHaveClass("tabs__list--underline");
    expect(tablist.querySelector(".tabs__indicator")).toBeInTheDocument();
  });
});
