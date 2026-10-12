import { describe, expect, it } from "vitest";
import {
  buildGroups,
  isLicenseText,
  licensesToReproduce,
  normalizeBody,
  parseSpdx,
  splitCopyright,
  titleForBody,
} from "./license-bundle.mjs";

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`;

const mit = (copyright, title = "") =>
  [title, title && "", copyright, copyright && "", MIT_BODY]
    .filter((l) => l !== undefined)
    .join("\n");

const pkg = (name, license, files = [], extra = {}) => ({
  name,
  version: "1.0.0",
  ecosystem: "cargo",
  license,
  files,
  ...extra,
});
const file = (text, kind = "license", name = "LICENSE") => ({
  kind,
  name,
  text,
});

describe("SPDX", () => {
  it("parses AND / OR / WITH / parentheses and the legacy slash", () => {
    expect(parseSpdx("MIT/Apache-2.0")).toEqual({
      op: "or",
      terms: [
        { op: "id", id: "MIT" },
        { op: "id", id: "Apache-2.0" },
      ],
    });
    expect(parseSpdx("(MIT OR Apache-2.0) AND Unicode-3.0").op).toBe("and");
    expect(parseSpdx("Apache-2.0 WITH LLVM-exception")).toEqual({
      op: "id",
      id: "Apache-2.0",
    });
    expect(() => parseSpdx("MIT AND")).toThrow();
  });

  it("picks one preferred alternative of an OR and keeps every AND term", () => {
    const have = ["MIT", "Apache-2.0", "Unicode-3.0"];
    expect(licensesToReproduce("Zlib OR Apache-2.0 OR MIT", have)).toEqual([
      "MIT",
    ]);
    expect(
      licensesToReproduce(
        "Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT",
        have,
      ),
    ).toEqual(["MIT"]);
    expect(
      licensesToReproduce("(MIT OR Apache-2.0) AND Unicode-3.0", have),
    ).toEqual(["MIT", "Unicode-3.0"]);
    expect(licensesToReproduce("MIT AND Zlib", have)).toEqual(["MIT", "Zlib"]);
  });

  it("prefers an alternative it has a template for", () => {
    expect(licensesToReproduce("Zlib OR Apache-2.0", ["Apache-2.0"])).toEqual([
      "Apache-2.0",
    ]);
  });
});

describe("splitCopyright", () => {
  it("keeps wrapped prose that merely starts with the word copyright in the body", () => {
    const text =
      "Copyright (c) 2013 Foo\n\nSOFTWARE. THE AUTHORS OR\nCOPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,\ncopyright notice and this permission notice";
    const { copyright, body } = splitCopyright(text);
    expect(copyright).toEqual(["Copyright (c) 2013 Foo"]);
    expect(body).toContain("COPYRIGHT HOLDERS BE LIABLE");
    expect(body).toContain("copyright notice and this permission notice");
  });

  it("separates the package's copyright lines from the license body", () => {
    const { copyright, body } = splitCopyright(
      mit("Copyright (c) 2015 Foo <foo@example.com>\nCopyright (c) 2018 Bar"),
    );
    expect(copyright).toEqual([
      "Copyright (c) 2015 Foo <foo@example.com>",
      "Copyright (c) 2018 Bar",
    ]);
    expect(body.startsWith("Permission is hereby granted")).toBe(true);
  });

  it("keeps template placeholders in the body and drops 'All rights reserved'", () => {
    const apacheAppendix = "Copyright [yyyy] [name of copyright owner]";
    expect(splitCopyright(apacheAppendix).copyright).toEqual([]);
    expect(splitCopyright("Copyright <year> <owner>").copyright).toEqual([]);
    const withRights = splitCopyright(
      "Copyright (c) 2020 Acme\nAll rights reserved.\n\nbody",
    );
    expect(withRights.copyright).toEqual(["Copyright (c) 2020 Acme"]);
    expect(withRights.body).toBe("body");
  });

  it("does not treat a mid-sentence mention as a copyright line", () => {
    expect(
      splitCopyright("The above copyright notice shall be included.").copyright,
    ).toEqual([]);
  });
});

describe("normalizeBody", () => {
  it("treats the same license as equal despite title, quotes, wrapping and trailing period", () => {
    const a = normalizeBody(MIT_BODY);
    const b = normalizeBody(
      `The MIT License (MIT)\n\n${MIT_BODY.replace(/"/g, "'").replace(/\n/g, "\n  ")}.`,
    );
    const c = normalizeBody(`# The MIT License (MIT)\n${MIT_BODY}`);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("ignores the Apache appendix and URL form", () => {
    const terms =
      "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\nTERMS\nEND OF TERMS AND CONDITIONS";
    const a = normalizeBody(terms);
    const b = normalizeBody(
      `${terms}\n\nAPPENDIX: How to apply\nCopyright {yyyy} {name of copyright owner}`,
    );
    const c = normalizeBody(
      terms.replace(
        "http://www.apache.org/licenses/",
        "https://www.apache.org/licenses/LICENSE-2.0",
      ),
    );
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("distinguishes different licenses", () => {
    expect(normalizeBody(MIT_BODY)).not.toBe(
      normalizeBody("Redistribution and use in source and binary forms"),
    );
  });
});

describe("titleForBody", () => {
  it("recognises common licenses, checking Unicode before MIT", () => {
    expect(titleForBody(MIT_BODY)).toBe("MIT License");
    expect(titleForBody(`UNICODE LICENSE V3\n\n${MIT_BODY}`)).toBe(
      "Unicode License v3",
    );
    expect(titleForBody("Apache License\nVersion 2.0, January 2004")).toBe(
      "Apache License 2.0",
    );
    expect(
      titleForBody(
        "Redistribution and use in source and binary forms ... Neither the name of",
      ),
    ).toBe("BSD 3-Clause License");
    expect(
      titleForBody("Redistribution and use in source and binary forms"),
    ).toBe("BSD 2-Clause License");
    expect(
      titleForBody(
        "// Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice",
      ),
    ).toBe("ISC License");
    expect(titleForBody("something unknown", "fallback")).toBe("fallback");
  });
});

describe("isLicenseText", () => {
  it("rejects pointer stubs and accepts real texts", () => {
    expect(isLicenseText("MIT OR Apache-2.0")).toBe(false);
    expect(
      isLicenseText(
        "This project is dual-licensed under the Unlicense and MIT licenses.",
      ),
    ).toBe(false);
    expect(isLicenseText(MIT_BODY)).toBe(true);
    expect(isLicenseText("x".repeat(500))).toBe(true);
  });
});

describe("buildGroups", () => {
  const templates = new Map([["MIT", MIT_BODY]]);

  it("puts the same license text in one group with each package's own copyright", () => {
    const { groups, unresolved } = buildGroups(
      [
        pkg("a", "MIT", [file(mit("Copyright (c) 2015 Alice"))]),
        pkg("b", "MIT", [
          file(mit("Copyright (c) 2019 Bob", "The MIT License (MIT)")),
        ]),
      ],
      templates,
    );
    expect(unresolved).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("MIT License");
    expect(groups[0].packages.map((p) => [p.name, p.copyright])).toEqual([
      ["a", ["Copyright (c) 2015 Alice"]],
      ["b", ["Copyright (c) 2019 Bob"]],
    ]);
  });

  it("uses the manifest authors when the license file has no copyright line", () => {
    const { groups } = buildGroups(
      [
        pkg("a", "MIT", [file(MIT_BODY)], {
          authors: ["Alice <alice@example.com>", "Bob"],
        }),
      ],
      templates,
    );
    expect(groups[0].packages[0].copyright).toEqual([
      "Authors (from package metadata): Alice, Bob",
    ]);
    expect(groups[0].packages[0].synthesized).toBe(false);
  });

  it("falls back to the canonical text when a package ships no license file", () => {
    const { groups, unresolved } = buildGroups(
      [
        pkg("noext", "Zlib OR Apache-2.0 OR MIT", [], {
          authors: ["Carol <c@example.com>"],
        }),
      ],
      templates,
    );
    expect(unresolved).toEqual([]);
    expect(groups[0].title).toBe("MIT License");
    expect(groups[0].packages[0]).toMatchObject({
      name: "noext",
      synthesized: true,
      copyright: ["Authors (from package metadata): Carol"],
    });
  });

  it("treats a pointer stub as missing", () => {
    const { groups } = buildGroups(
      [pkg("stub", "MIT", [file("MIT OR Apache-2.0")])],
      templates,
    );
    expect(groups[0].packages[0].synthesized).toBe(true);
  });

  it("reports packages it cannot resolve instead of dropping them", () => {
    const { groups, unresolved } = buildGroups(
      [
        pkg("weird", "ISC", []),
        pkg("broken", "MIT AND", []),
        pkg("fine", "MIT", [file(MIT_BODY)]),
      ],
      templates,
    );
    expect(groups).toHaveLength(1);
    expect(unresolved).toHaveLength(2);
    expect(unresolved.join("\n")).toMatch(/weird.*no template for ISC/);
    expect(unresolved.join("\n")).toMatch(/broken.*unparseable/);
  });

  it("keeps NOTICE files separate from license text", () => {
    const { groups } = buildGroups(
      [
        pkg("a", "MIT", [
          file(MIT_BODY),
          file(
            "This product includes software developed at Acme Corp.",
            "notice",
            "NOTICE",
          ),
        ]),
      ],
      templates,
    );
    expect(groups.map((g) => g.kind).sort()).toEqual(["license", "notice"]);
  });

  it("is deterministic regardless of input order", () => {
    const packages = [
      pkg("b", "MIT", [file(mit("Copyright (c) B"))]),
      pkg("a", "MIT", [file(mit("Copyright (c) A"))]),
    ];
    const one = buildGroups(packages, templates).groups;
    const two = buildGroups([...packages].reverse(), templates).groups;
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});
