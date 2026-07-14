/** LIFO stack of open modal layers so only the topmost handles dismiss. */
const stack: symbol[] = [];

export function pushModalLayer(): symbol {
  const id = Symbol("modal");
  stack.push(id);
  return id;
}

export function popModalLayer(id: symbol): void {
  const idx = stack.lastIndexOf(id);
  if (idx !== -1) stack.splice(idx, 1);
}

export function isTopModalLayer(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** Test helper — clears the stack between cases. */
export function resetModalStack(): void {
  stack.length = 0;
}
