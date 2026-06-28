import { describe, expect, it } from "vitest";
import {
  bucketToCanonical,
  bucketToDisplayValue,
  bucketToFraction,
  canonicalToBucket,
  canonicalToDisplayValue,
  canonicalToFraction,
  DEFAULT_BUCKET_CANONICALS,
  DEFAULT_BUCKET_COUNT,
  DEFAULT_DISPLAY_SCALE_MAX,
  formatRatingValue,
  isUnrated,
  UNRATED,
} from "./trackRating";

describe("canonicalToBucket", () => {
  it("returns 0 for unrated canonical values", () => {
    expect(canonicalToBucket(UNRATED, DEFAULT_BUCKET_COUNT)).toBe(0);
    expect(canonicalToBucket(UNRATED, 5)).toBe(0);
  });

  it("maps each default-bucket canonical value to the expected bucket", () => {
    DEFAULT_BUCKET_CANONICALS.forEach((canonical, index) => {
      expect(canonicalToBucket(canonical, DEFAULT_BUCKET_COUNT)).toBe(index + 1);
    });
  });
});

describe("bucketToCanonical", () => {
  it("returns UNRATED for bucket 0", () => {
    expect(bucketToCanonical(0, DEFAULT_BUCKET_COUNT)).toBe(UNRATED);
  });

  it("maps each default bucket to the expected canonical value", () => {
    DEFAULT_BUCKET_CANONICALS.forEach((canonical, index) => {
      expect(bucketToCanonical(index + 1, DEFAULT_BUCKET_COUNT)).toBe(canonical);
    });
  });
});

describe("round-trip conversion", () => {
  it("preserves every default bucket through canonical and back", () => {
    for (let bucket = 1; bucket <= DEFAULT_BUCKET_COUNT; bucket += 1) {
      const canonical = bucketToCanonical(bucket, DEFAULT_BUCKET_COUNT);
      expect(canonicalToBucket(canonical, DEFAULT_BUCKET_COUNT)).toBe(bucket);
    }
  });

  it("preserves every default canonical value through bucket and back", () => {
    for (const canonical of DEFAULT_BUCKET_CANONICALS) {
      const bucket = canonicalToBucket(canonical, DEFAULT_BUCKET_COUNT);
      expect(bucketToCanonical(bucket, DEFAULT_BUCKET_COUNT)).toBe(canonical);
    }
  });
});

describe("boundary and collision rules", () => {
  it("never maps unrated canonical to bucket 1", () => {
    expect(isUnrated(UNRATED)).toBe(true);
    expect(canonicalToBucket(UNRATED, DEFAULT_BUCKET_COUNT)).toBe(0);
  });

  it("assigns distinct canonical values to adjacent buckets", () => {
    for (let bucket = 1; bucket < DEFAULT_BUCKET_COUNT; bucket += 1) {
      const current = bucketToCanonical(bucket, DEFAULT_BUCKET_COUNT);
      const next = bucketToCanonical(bucket + 1, DEFAULT_BUCKET_COUNT);
      expect(current).not.toBe(next);
    }
  });
});

describe("fraction helpers", () => {
  it("maps buckets and canonical values to 0–1", () => {
    expect(bucketToFraction(0)).toBe(0);
    expect(bucketToFraction(DEFAULT_BUCKET_COUNT)).toBe(1);
    expect(canonicalToFraction(UNRATED)).toBe(0);
    expect(canonicalToFraction(255)).toBe(1);
  });
});

describe("display helpers", () => {
  it("formats values on the default display scale", () => {
    expect(formatRatingValue(UNRATED)).toBe("—");
    expect(formatRatingValue(179)).toBe("3.5");
    expect(formatRatingValue(153)).toBe("3");
    expect(formatRatingValue(255)).toBe("5");
  });

  it("derives display values from canonical ratings", () => {
    expect(canonicalToDisplayValue(UNRATED)).toBe(0);
    expect(canonicalToDisplayValue(179)).toBe(3.5);
    expect(canonicalToDisplayValue(255)).toBe(DEFAULT_DISPLAY_SCALE_MAX);
    expect(bucketToDisplayValue(7, DEFAULT_BUCKET_COUNT, 10)).toBe(7);
  });
});
