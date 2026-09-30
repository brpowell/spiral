import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import "./Tabs.css";

export type TabsVariant = "default" | "underline";

type TabsContextValue = {
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
  variant: TabsVariant;
  tabValues: string[];
  setTabValues: (values: string[]) => void;
  registerTabButton: (value: string, node: HTMLButtonElement | null) => void;
  getTabButton: (value: string) => HTMLButtonElement | undefined;
  focusTab: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (context == null) {
    throw new Error("Tabs descendants must be used within a Tabs component");
  }
  return context;
}

export type TabsProps = {
  value: string;
  onChange: (value: string) => void;
  variant?: TabsVariant;
  className?: string;
  children: ReactNode;
};

export function Tabs({
  value,
  onChange,
  variant = "default",
  className,
  children,
}: TabsProps) {
  const idPrefix = useId();
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [tabValues, setTabValues] = useState<string[]>([]);

  const registerTabButton = useCallback(
    (tabValue: string, node: HTMLButtonElement | null) => {
      if (node) tabButtonRefs.current.set(tabValue, node);
      else tabButtonRefs.current.delete(tabValue);
    },
    [],
  );

  const getTabButton = useCallback(
    (tabValue: string) => tabButtonRefs.current.get(tabValue),
    [],
  );

  const focusTab = useCallback((tabValue: string) => {
    tabButtonRefs.current.get(tabValue)?.focus();
  }, []);

  const contextValue = useMemo(
    () => ({
      value,
      onChange,
      idPrefix,
      variant,
      tabValues,
      setTabValues,
      registerTabButton,
      getTabButton,
      focusTab,
    }),
    [
      value,
      onChange,
      idPrefix,
      variant,
      tabValues,
      registerTabButton,
      getTabButton,
      focusTab,
    ],
  );

  const rootClass = [
    "tabs",
    variant !== "default" && `tabs--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={rootClass}>{children}</div>
    </TabsContext.Provider>
  );
}

export type TabListProps = {
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /**
   * Fade panel content under the tab strip using `--tabs-fade-height`.
   */
  fade?: boolean;
  children: ReactNode;
};

function isTabElement(child: ReactNode): child is ReactElement<TabProps> {
  return isValidElement(child) && child.type === Tab;
}

export function TabList({
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  fade = false,
  children,
}: TabListProps) {
  const {
    value,
    variant,
    tabValues,
    setTabValues,
    focusTab,
    onChange,
    getTabButton,
  } = useTabsContext();
  const listRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<CSSProperties | null>(
    null,
  );

  useEffect(() => {
    const values = Children.toArray(children)
      .filter(isTabElement)
      .map((child) => child.props.value);
    setTabValues(values);
  }, [children, setTabValues]);

  useLayoutEffect(() => {
    if (variant !== "underline") {
      setIndicatorStyle(null);
      return;
    }

    const updateIndicator = () => {
      const list = listRef.current;
      const tab = getTabButton(value);
      if (!list || !tab) {
        setIndicatorStyle(null);
        return;
      }

      const listRect = list.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();

      setIndicatorStyle({
        left: tabRect.left - listRect.left + list.scrollLeft,
        width: tabRect.width,
      });
    };

    updateIndicator();

    const list = listRef.current;
    const tab = getTabButton(value);
    if (!list) return;

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(list);
    if (tab) resizeObserver.observe(tab);

    window.addEventListener("resize", updateIndicator);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [variant, value, getTabButton, tabValues]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (tabValues.length === 0) return;

    const currentIndex = tabValues.indexOf(value);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % tabValues.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + tabValues.length) % tabValues.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabValues.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextValue = tabValues[nextIndex];
    onChange(nextValue);
    focusTab(nextValue);
  };

  const listClass = [
    "tabs__list",
    variant === "underline" && "tabs__list--underline",
    fade && "tabs__list--fade",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={listRef}
      role="tablist"
      className={listClass}
      onKeyDown={handleKeyDown}
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
      {variant === "underline" && indicatorStyle != null ? (
        <span className="tabs__indicator" style={indicatorStyle} aria-hidden />
      ) : null}
    </div>
  );
}

export type TabProps = {
  value: string;
  badge?: ReactNode;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

export function Tab({
  value,
  badge,
  disabled = false,
  className,
  children,
}: TabProps) {
  const {
    value: selectedValue,
    onChange,
    idPrefix,
    registerTabButton,
  } = useTabsContext();
  const tabId = `${idPrefix}-tab-${value}`;
  const panelId = `${idPrefix}-panel-${value}`;
  const isSelected = selectedValue === value;

  const tabClass = ["tabs__tab", isSelected && "tabs__tab--selected", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={(node) => registerTabButton(value, node)}
      type="button"
      role="tab"
      id={tabId}
      className={tabClass}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      onClick={() => onChange(value)}
    >
      <span>{children}</span>
      {badge != null ? (
        <span className="tabs__badge" aria-hidden>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export type TabPanelProps = {
  value: string;
  className?: string;
  /** When true, keep children mounted while the panel is hidden. */
  keepMounted?: boolean;
  children: ReactNode;
};

export function TabPanel({
  value,
  className,
  keepMounted = false,
  children,
}: TabPanelProps) {
  const { value: selectedValue, idPrefix } = useTabsContext();
  const panelId = `${idPrefix}-panel-${value}`;
  const tabId = `${idPrefix}-tab-${value}`;
  const isSelected = selectedValue === value;

  const panelClass = ["tabs__panel", className].filter(Boolean).join(" ");

  return (
    <div
      role="tabpanel"
      id={panelId}
      className={panelClass}
      aria-labelledby={tabId}
      hidden={!isSelected}
    >
      {isSelected || keepMounted ? children : null}
    </div>
  );
}
