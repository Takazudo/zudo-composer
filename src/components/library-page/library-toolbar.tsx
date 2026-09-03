import { Fragment, type ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { ChevronDownIcon, FilterIcon, GridIcon, ListIcon, SearchIcon, SortIcon, type IconComponent } from "../icons";
import { Menu, MenuRadioItem, useMenu } from "../overlay";
import { cx, Input, SegmentedControl } from "../ui";
import type { LibraryFacet, LibraryQueryController, LibrarySort } from "./library-query";

// The library toolbar (issue #164): filter input, one menu per facet, the sort
// menu, and a trailing slot for the optional view toggle. Handed a
// `LibraryQueryController` it wires all of them; handed none it is just the
// layout row, for a route that drives its own controls.

interface ChoiceOption {
  readonly id: string;
  readonly label: string;
}

interface ChoiceMenuProps {
  /** Names the menu; also prefixes the trigger when `prefixTrigger` is set. */
  label: string;
  icon?: IconComponent;
  options: readonly ChoiceOption[];
  value: string | null;
  onChange: (id: string) => void;
  /** `Kind: All` for a facet; a bare `Updated` for sort. */
  prefixTrigger?: boolean;
}

function ChoiceMenu({ label, icon: Icon, options, value, onChange, prefixTrigger = false }: ChoiceMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef);
  const selected = options.find((option) => option.id === value) ?? options[0];
  const selectedLabel = selected?.label ?? "";

  return (
    <Fragment>
      {/* Raw button: the menu measures its trigger through a ref, which Preact
       * does not forward to a function component. */}
      <button type="button" ref={triggerRef} class="cms-btn cms-btn--sm" {...menu.triggerProps}>
        {Icon ? <Icon size="sm" /> : null}
        <span>{prefixTrigger ? `${label}: ${selectedLabel}` : selectedLabel}</span>
        <ChevronDownIcon size="xs" class="cms-library-toolbar__caret" />
      </button>
      <Menu controller={menu} label={label}>
        {options.map((option) => (
          <MenuRadioItem key={option.id} checked={option.id === selected?.id} onSelect={() => onChange(option.id)}>
            {option.label}
          </MenuRadioItem>
        ))}
      </Menu>
    </Fragment>
  );
}

export interface LibraryFacetMenuProps<Row> {
  facet: LibraryFacet<Row>;
  value: string;
  onChange: (optionId: string) => void;
}

export function LibraryFacetMenu<Row>({ facet, value, onChange }: LibraryFacetMenuProps<Row>) {
  return (
    <ChoiceMenu
      label={facet.label}
      icon={facet.icon ?? FilterIcon}
      options={facet.options}
      value={value}
      onChange={onChange}
      prefixTrigger
    />
  );
}

export interface LibrarySortMenuProps<Row> {
  sorts: readonly LibrarySort<Row>[];
  value: string | null;
  onChange: (sortId: string) => void;
  label?: string;
}

export function LibrarySortMenu<Row>({ sorts, value, onChange, label = "Sort" }: LibrarySortMenuProps<Row>) {
  return <ChoiceMenu label={label} icon={SortIcon} options={sorts} value={value} onChange={onChange} />;
}

export type LibraryView = "table" | "cards";

export interface LibraryViewToggleProps {
  value: LibraryView;
  onChange: (view: LibraryView) => void;
  label?: string;
  tableLabel?: string;
  cardsLabel?: string;
}

export function LibraryViewToggle({
  value,
  onChange,
  label = "View",
  tableLabel = "Table",
  cardsLabel = "Cards",
}: LibraryViewToggleProps) {
  return (
    <SegmentedControl<LibraryView>
      label={label}
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "table", icon: ListIcon, ariaLabel: tableLabel },
        { value: "cards", icon: GridIcon, ariaLabel: cardsLabel },
      ]}
    />
  );
}

export interface LibraryToolbarProps<Row> {
  /** Drives the filter input, the facet menus and the sort menu. */
  query?: LibraryQueryController<Row>;
  /** Accessible name of the filter input. */
  searchLabel?: string;
  searchPlaceholder?: string;
  /** Extra controls, after the generated menus. */
  children?: ComponentChildren;
  /** Trailing controls, pushed to the inline end — the view toggle. */
  end?: ComponentChildren;
  class?: string;
}

export function LibraryToolbar<Row>({
  query,
  searchLabel = "Filter records",
  searchPlaceholder = "Filter by name or ID",
  children,
  end,
  class: className,
}: LibraryToolbarProps<Row>) {
  return (
    <div class={cx("cms-library-toolbar", className)}>
      {query ? (
        <Input
          class="cms-library-toolbar__search"
          size="sm"
          type="search"
          icon={SearchIcon}
          value={query.search}
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          onInput={(event) => query.setSearch(event.currentTarget.value)}
        />
      ) : null}
      {query?.facets.map((facet) => (
        <LibraryFacetMenu
          key={facet.id}
          facet={facet}
          value={query.facetValue(facet.id)}
          onChange={(optionId) => query.setFacetValue(facet.id, optionId)}
        />
      ))}
      {query && query.sorts.length > 0 ? (
        <LibrarySortMenu sorts={query.sorts} value={query.sortId} onChange={query.setSortId} />
      ) : null}
      {children}
      {end === undefined ? null : (
        <Fragment>
          <span class="cms-library-toolbar__spacer" />
          {end}
        </Fragment>
      )}
    </div>
  );
}
