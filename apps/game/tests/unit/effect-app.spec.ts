/**
 * App services (docs/EFFECT.md step 6): Loading, Input, Audio and World lifetimes.
 * Pure Node: fake Intro / EventTarget / unlock / world factory, no browser.
 */
import { expect, test } from "@playwright/test";
import { Effect, Exit, Fiber, Layer, Scope } from "effect";
import { makeLoading } from "../../src/app/loading";
import { makeInput } from "../../src/app/input";
import { makeAudio } from "../../src/app/audio";
import { makeErrorBoundary } from "../../src/app/boundary";
import { World } from "../../src/app/world";
import { Shell } from "../../src/app/ui";

function fakeIntro() {
  const log: string[] = [];
  let n = 0;
  return {
    log,
    track(weight: number, tauMs: number, deferred = false) {
      const id = n++;
      log.push(`track ${id} ${weight} ${tauMs} ${deferred}`);
      return { start: () => void log.push(`start ${id}`), done: () => void log.push(`done ${id}`) };
    },
  };
}

test.describe("Loading", () => {
  test("registers every step up front; done on success, start only for deferred steps", async () => {
    const intro = fakeIntro();
    const loading = makeLoading(intro);
    const a = loading.step(2, 1500);
    const b = loading.step(3, 3000, true);
    expect(intro.log).toEqual(["track 0 2 1500 false", "track 1 3 3000 true"]);
    expect(await Effect.runPromise(a.run(Effect.succeed(1)))).toBe(1);
    expect(intro.log.slice(2)).toEqual(["done 0"]);
    await Effect.runPromise(b.run(Effect.sync(() => void intro.log.push("work"))));
    expect(intro.log.slice(3)).toEqual(["start 1", "work", "done 1"]);
  });

  test("done on failure and on interruption", async () => {
    const intro = fakeIntro();
    const loading = makeLoading(intro);
    const failing = loading.step(5, 6000);
    const hanging = loading.step(3, 3000, true);
    const exit = await Effect.runPromise(Effect.exit(failing.run(Effect.fail("boom"))));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(intro.log).toContain("done 0");
    const fiber = Effect.runFork(hanging.run(Effect.never));
    await Effect.runPromise(Effect.yieldNow);
    expect(intro.log).toContain("start 1");
    expect(intro.log).not.toContain("done 1");
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(intro.log).toContain("done 1");
  });
});

test.describe("Input", () => {
  test("listener is live until the scope closes; a throwing handler is reported, not rethrown", async () => {
    const target = new EventTarget();
    const toasts: string[] = [];
    const errors: unknown[][] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const boundary = makeErrorBoundary((t) => toasts.push(t));
      const scope = Effect.runSync(Scope.make());
      const input = makeInput(boundary, scope);
      const seen: string[] = [];
      input.listenSync(target, "ping", (e) => seen.push(e.type));
      input.listenSync(target, "boom", () => {
        throw new Error("handler broke");
      });
      target.dispatchEvent(new Event("ping"));
      expect(() => target.dispatchEvent(new Event("boom"))).not.toThrow();
      expect(seen).toEqual(["ping"]);
      expect(errors.some((a) => a[0] === "[app] boom")).toBe(true);
      expect(toasts).toHaveLength(1);
      await Effect.runPromise(Scope.close(scope, Exit.void));
      target.dispatchEvent(new Event("ping"));
      expect(seen).toEqual(["ping"]);
    } finally {
      console.error = error;
    }
  });
});

test.describe("Audio", () => {
  const fakeAmbience = () => {
    const a = { starts: 0, start: () => Promise.resolve(void a.starts++) };
    return a;
  };
  const counting = () => {
    const target = new EventTarget();
    const live = { keydown: 0, pointerdown: 0 };
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) => {
      live[type as keyof typeof live]++;
      add(type, l, o);
    };
    target.removeEventListener = (type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) => {
      live[type as keyof typeof live] = Math.max(0, live[type as keyof typeof live] - 1);
      remove(type, l, o);
    };
    return { target, live };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test("start: unlock fails → retry listeners stay; a later key press unlocks and removes them", async () => {
    const { target, live } = counting();
    const ambience = fakeAmbience();
    let ok = false;
    let unlocks = 0;
    const unlock = () => (unlocks++, ok ? Promise.resolve() : Promise.reject(new Error("no gesture")));
    let closed = 0;
    const scope = Effect.runSync(Scope.make());
    const audio = Effect.runSync(
      makeAudio({ deck: {} as never, ambience: ambience as never, unlock, close: () => void closed++, target }).pipe(Scope.provide(scope)),
    );
    audio.start();
    expect(live).toEqual({ keydown: 1, pointerdown: 1 });
    await flush();
    expect(ambience.starts).toBe(0);
    expect(live).toEqual({ keydown: 1, pointerdown: 1 });
    ok = true;
    target.dispatchEvent(new Event("keydown"));
    await flush();
    expect(unlocks).toBe(2);
    expect(ambience.starts).toBe(1);
    expect(live).toEqual({ keydown: 0, pointerdown: 0 });
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(closed).toBe(1);
  });

  test("scope close removes pending retry listeners and closes the context", async () => {
    const { target, live } = counting();
    let closed = 0;
    const scope = Effect.runSync(Scope.make());
    const audio = Effect.runSync(
      makeAudio({
        deck: {} as never,
        ambience: fakeAmbience() as never,
        unlock: () => Promise.reject(new Error("no gesture")),
        close: () => void closed++,
        target,
      }).pipe(Scope.provide(scope)),
    );
    audio.start();
    await flush();
    expect(live).toEqual({ keydown: 1, pointerdown: 1 });
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(live).toEqual({ keydown: 0, pointerdown: 0 });
    expect(closed).toBe(1);
  });
});

test.describe("World", () => {
  test("the layer builds the world into the shell's host and disposes it on scope close (only then)", async () => {
    const host = { id: "world" } as unknown as HTMLElement;
    const calls: string[] = [];
    const layer = World.layerWith((h) => {
      calls.push(`make ${(h as unknown as { id: string }).id}`);
      return { dispose: () => void calls.push("dispose") } as never;
    }).pipe(Layer.provide(Layer.succeed(Shell, { app: {} as never, worldHost: host })));
    const scope = Effect.runSync(Scope.make());
    await Effect.runPromise(Layer.build(layer).pipe(Scope.provide(scope)));
    expect(calls).toEqual(["make world"]);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(calls).toEqual(["make world", "dispose"]);
  });
});
