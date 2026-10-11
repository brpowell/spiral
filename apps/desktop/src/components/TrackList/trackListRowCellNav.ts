const TABBABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TRACK_LIST_CELL_CONTROL = "data-track-list-cell-control";
const TRACK_LIST_CELL_COLUMN = "data-track-list-cell-column";
const TRACK_LIST_CELL_SUB_INDEX = "data-track-list-cell-sub-index";

export type CellControlColumn = "artist" | "album" | "rating" | "check";

export interface CellControlLocation {
  column: CellControlColumn;
  subIndex: number;
}

function getCellControlLocation(
  target: HTMLElement,
): CellControlLocation | null {
  const el = target.closest<HTMLElement>(`[${TRACK_LIST_CELL_CONTROL}]`);
  if (!el) return null;
  const column = el.getAttribute(TRACK_LIST_CELL_COLUMN);
  if (
    column !== "artist" &&
    column !== "album" &&
    column !== "rating" &&
    column !== "check"
  ) {
    return null;
  }
  const subIndex = Number(el.getAttribute(TRACK_LIST_CELL_SUB_INDEX) ?? "0");
  return { column, subIndex: Number.isFinite(subIndex) ? subIndex : 0 };
}

export function findMatchingCellControl(
  rowEl: HTMLElement,
  location: CellControlLocation,
): HTMLElement | null {
  const controls = Array.from(
    rowEl.querySelectorAll<HTMLElement>(
      `[${TRACK_LIST_CELL_CONTROL}][${TRACK_LIST_CELL_COLUMN}="${location.column}"]`,
    ),
  );
  if (controls.length === 0) return null;
  return controls[Math.min(location.subIndex, controls.length - 1)] ?? null;
}

function isActionableCellColumn(column: CellControlColumn): boolean {
  return column === "artist" || column === "album" || column === "check";
}

function activateCellControl(target: HTMLElement): void {
  const control =
    target.closest<HTMLElement>(`[${TRACK_LIST_CELL_CONTROL}]`) ?? target;
  control.click();
}

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

function isTabbable(el: HTMLElement): boolean {
  if (!isVisible(el) || el.closest("[inert]")) return false;
  const tabIndexAttr = el.getAttribute("tabindex");
  if (tabIndexAttr === "-1") return false;
  if (tabIndexAttr != null) return true;
  return el.matches(TABBABLE_SELECTOR);
}

function getDocumentTabbables(): HTMLElement[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      `${TABBABLE_SELECTOR}, [tabindex]:not([tabindex="-1"])`,
    ),
  );
  const seen = new Set<HTMLElement>();
  const tabbables: HTMLElement[] = [];
  for (const el of candidates) {
    if (seen.has(el) || !isTabbable(el)) continue;
    seen.add(el);
    tabbables.push(el);
  }
  return tabbables;
}

function getRowCellControls(rowEl: HTMLElement): HTMLElement[] {
  return Array.from(
    rowEl.querySelectorAll<HTMLElement>(`[${TRACK_LIST_CELL_CONTROL}]`),
  ).filter((el) => !el.closest('[aria-disabled="true"]'));
}

function isRowCellControl(
  target: EventTarget | null,
  rowEl: HTMLElement,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(`[${TRACK_LIST_CELL_CONTROL}]`) != null && rowEl.contains(target);
}

function getListTabbables(listRoot: HTMLElement): HTMLElement[] {
  return getDocumentTabbables().filter((el) => listRoot.contains(el));
}

function focusBeforeRows(listRoot: HTMLElement, rowEl: HTMLElement): void {
  const listTabbables = getListTabbables(listRoot);
  const rowIndex = listTabbables.indexOf(rowEl);
  if (rowIndex > 0) {
    listTabbables[rowIndex - 1].focus({ preventScroll: true, focusVisible: true });
    return;
  }
  if (listTabbables.length > 0) {
    focusAdjacentInList(listRoot, listTabbables[0], -1);
  }
}

function focusAdjacentInList(
  listRoot: HTMLElement,
  currentEl: HTMLElement,
  direction: 1 | -1,
): void {
  const listTabbables = getListTabbables(listRoot);
  const currentIndex = listTabbables.indexOf(currentEl);

  if (currentIndex !== -1) {
    const nextIndex = currentIndex + direction;
    if (nextIndex >= 0 && nextIndex < listTabbables.length) {
      listTabbables[nextIndex].focus({ preventScroll: true, focusVisible: true });
      return;
    }
  }

  const allTabbables = getDocumentTabbables();
  const boundaryEl =
    direction === 1
      ? listTabbables[listTabbables.length - 1]
      : listTabbables[0];
  if (!boundaryEl) return;

  const boundaryIndex = allTabbables.indexOf(boundaryEl);
  if (boundaryIndex === -1) return;

  allTabbables[boundaryIndex + direction]?.focus({
    preventScroll: true,
    focusVisible: true,
  });
}

function focusCellControl(
  controls: HTMLElement[],
  index: number,
): void {
  controls[index]?.focus({ preventScroll: true, focusVisible: true });
}

function navigateCellControls(
  rowEl: HTMLElement,
  target: HTMLElement,
  direction: 1 | -1,
): boolean {
  const controls = getRowCellControls(rowEl);
  if (controls.length === 0) return false;

  const activeControl =
    target.closest<HTMLElement>(`[${TRACK_LIST_CELL_CONTROL}]`) ?? target;
  const currentIndex = controls.indexOf(activeControl);
  if (currentIndex === -1) return false;

  const nextIndex = currentIndex + direction;
  if (nextIndex >= 0 && nextIndex < controls.length) {
    focusCellControl(controls, nextIndex);
    return true;
  }

  rowEl.focus({ preventScroll: true, focusVisible: true });
  return true;
}

export function handleTrackListRowCellKeyDown(
  e: React.KeyboardEvent,
  rowEl: HTMLElement,
  listRoot: HTMLElement | null,
  onRowCellNavigation: (
    e: React.KeyboardEvent,
    location: CellControlLocation,
  ) => void,
): boolean {
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (!target || !rowEl.contains(target)) return false;

  if (e.key === "Tab") {
    if (!listRoot) return false;
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      focusBeforeRows(listRoot, rowEl);
    } else {
      focusAdjacentInList(listRoot, rowEl, 1);
    }
    return true;
  }

  if (e.key === "Enter") {
    if (!isRowCellControl(target, rowEl)) return false;
    const location = getCellControlLocation(target);
    if (!location || !isActionableCellColumn(location.column)) return false;
    e.preventDefault();
    e.stopPropagation();
    activateCellControl(target);
    return true;
  }

  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (!isRowCellControl(target, rowEl)) return false;
    const location = getCellControlLocation(target);
    if (!location) return false;
    e.preventDefault();
    e.stopPropagation();
    onRowCellNavigation(e, location);
    return true;
  }

  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;

  const direction: 1 | -1 = e.key === "ArrowRight" ? 1 : -1;
  const controls = getRowCellControls(rowEl);
  if (controls.length === 0) return false;

  if (target === rowEl) {
    e.preventDefault();
    e.stopPropagation();
    focusCellControl(controls, direction === 1 ? 0 : controls.length - 1);
    return true;
  }

  if (!isRowCellControl(target, rowEl)) return false;

  e.preventDefault();
  e.stopPropagation();
  navigateCellControls(rowEl, target, direction);
  return true;
}
