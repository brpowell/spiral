import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ThirdPartyLicenses,
  type ThirdPartyLicenseData,
} from "./ThirdPartyLicenses";

const data: ThirdPartyLicenseData = {
  packageCount: 3,
  groups: [
    {
      id: "mit-aaaaaa",
      title: "MIT License",
      kind: "license",
      text: "Permission is hereby granted, free of charge",
      packages: [
        {
          name: "left-pad",
          version: "1.0.0",
          ecosystem: "npm",
          copyright: ["Copyright (c) 2016 Azer"],
        },
        {
          name: "serde",
          version: "1.0.200",
          ecosystem: "cargo",
          copyright: ["Copyright (c) Erick Tryzelaar"],
        },
      ],
    },
    {
      id: "isc-bbbbbb",
      title: "ISC License",
      kind: "license",
      text: "Permission to use, copy, modify, and/or distribute",
      packages: [
        {
          name: "semver",
          version: "7.0.0",
          ecosystem: "npm",
          copyright: ["Isaac Z. Schlueter"],
        },
      ],
    },
  ],
};

describe("ThirdPartyLicenses", () => {
  it("shows a loading state, then the license groups collapsed", async () => {
    render(<ThirdPartyLicenses loadData={() => Promise.resolve(data)} />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    expect(await screen.findByText("MIT License")).toBeInTheDocument();
    expect(screen.getByText("ISC License")).toBeInTheDocument();
    expect(screen.getByText("3 packages")).toBeInTheDocument();
    expect(screen.queryByText(/Permission is hereby granted/)).toBeNull();
  });

  it("shows packages, copyright and license text when a group is opened", async () => {
    render(<ThirdPartyLicenses loadData={() => Promise.resolve(data)} />);
    const title = await screen.findByText("MIT License");
    const details = title.closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    expect(await screen.findByText("left-pad 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Copyright (c) 2016 Azer")).toBeInTheDocument();
    expect(
      screen.getByText(/Permission is hereby granted/),
    ).toBeInTheDocument();
  });

  it("filters by package name and expands the matching groups", async () => {
    render(<ThirdPartyLicenses loadData={() => Promise.resolve(data)} />);
    await screen.findByText("MIT License");

    fireEvent.change(screen.getByLabelText("Search packages"), {
      target: { value: "semver" },
    });

    expect(screen.getByText("semver 7.0.0")).toBeInTheDocument();
    expect(screen.queryByText("MIT License")).toBeNull();
    expect(screen.queryByText("left-pad 1.0.0")).toBeNull();
  });

  it("reports when nothing matches", async () => {
    render(<ThirdPartyLicenses loadData={() => Promise.resolve(data)} />);
    await screen.findByText("MIT License");

    fireEvent.change(screen.getByLabelText("Search packages"), {
      target: { value: "nope" },
    });

    expect(screen.getByText(/No packages match/)).toBeInTheDocument();
  });

  it("shows an error when the data cannot be loaded", async () => {
    render(
      <ThirdPartyLicenses loadData={() => Promise.reject(new Error("x"))} />,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
