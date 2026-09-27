// G06.01.b (issue #314) — shared render-test helpers: the fetch mock over
// fixture texts, the digest adapter and the services-provider layout. One
// copy for the app suites — sibling variants are jscpd clones
// (implementation-rules 3, 8).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { jest } from "@jest/globals";
import { Stack } from "expo-router";

import { ServicesContext } from "../app/_layout";
import type { Services } from "../controllers/createServices";

export const FIXTURES = join(dirname(__filename), "..", "fixtures", "discovery-contract");

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export const sha256 = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function serve(paths: Record<string, string>) {
  return jest.spyOn(global, "fetch").mockImplementation(async (input: unknown) => {
    const url = String(input);
    const hit = Object.entries(paths).find(([rel]) => url.endsWith(rel));
    if (!hit) return { ok: false, status: 404, text: async () => "no" } as unknown as Response;
    return { ok: true, status: 200, text: async () => hit[1] } as unknown as Response;
  });
}

export function layoutWith(services: Services) {
  // The test layout mirrors app/_layout.tsx: the provider around the Stack
  // navigator (expo-router reads the routes from context, children are not
  // rendered explicitly).
  return function TestLayout() {
    return (
      <ServicesContext.Provider value={services}>
        <Stack />
      </ServicesContext.Provider>
    );
  };
}
