import { computed, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { ChevronDownIcon, FilterIcon, GridIcon, ListIcon, SearchIcon, SortIcon, type IconComponent } from "../icons";
import { createMenu, Menu, MenuRadioItem } from "../overlay";
import { read, type MaybeSignal } from "../reactive";
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
  value: MaybeSignal<string | null>;
  onChange: (id: string) => void;
  /** `Kind: All` for a facet; a bare `Updated` for sort. */
  prefixTrigger?: boolean;
}

function ChoiceMenu({ label, icon: Icon, options, value, onChange, prefixTrigger = false }: ChoiceMenuProps): Child {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef);
  const selected = computed(() => {
    const current = read(value);
    return options.find((option) => option.id === current) ?? options[0];
  });
  const selectedLabel = computed(() => selected.value?.label ?? "");

  return (
    <>
      {/* A facet trigger already reads `Kind: All`. An unprefixed one shows
       * only its value, and its icon is decorative, so its accessible name has
       * to say what that value belongs to. */}
      <button
        type="button"
        ref={triggerRef}
        class="cms-btn cms-btn--sm"
        aria-label={prefixTrigger ? undefined : computed(() => `${label}: ${selectedLabel.value}`)}
        {...menu.triggerProps}
      >
        {Icon ? <Icon size="sm" /> : null}
        <span>{prefixTrigger ? computed(() => `${label}: ${selectedLabel.value}`) : selectedLabel}</span>
        <ChevronDownIcon size="xs" class="cms-library-toolbar__caret" />
      </button>
      <Menu controller={menu} label={label}>
        {options.map((option) => (
          <MenuRadioItem checked={computed(() => option.id === selected.value?.id)} onSelect={() => onChange(option.id)}>
            {option.label}
          </MenuRadioItem>
        ))}
      </Menu>
    </>
  );
}

export interface LibraryFacetMenuProps<Row> {
  facet: LibraryFacet<Row>;
  value: MaybeSignal<string>;
  onChange: (optionId: string) => void;
}

export function LibraryFacetMenu<Row>({ facet, value, onChange }: LibraryFacetMenuProps<Row>): Child {
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
  value: MaybeSignal<string | null>;
  onChange: (sortId: string) => void;
  label?: string;
}

export function LibrarySortMenu<Row>({ sorts, value, onChange, label = "Sort" }: LibrarySortMenuProps<Row>): Child {
  return <ChoiceMenu label={label} icon={SortIcon} options={sorts} value={value} onChange={onChange} />;
}

export type LibraryView = "table" | "cards";

export interface LibraryViewToggleProps {
  value: MaybeSignal<LibraryView>;
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
}: LibraryViewToggleProps): Child {
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
  children?: Child;
  /** Trailing controls, pushed to the inline end — the view toggle. */
  end?: Child;
  class?: string;
}

export function LibraryToolbar<Row>({
  query,
  searchLabel = "Filter records",
  searchPlaceholder = "Filter by name or ID",
  children,
  end,
  class: className,
}: LibraryToolbarProps<Row>): Child {
  return (
    <div class={cx("cms-library-toolbar", className)}>
      {query ? (
        <Input
          class="cms-library-toolbar__search"
          size="sm"
          type="search"
          icon={SearchIcon}
          modelValue={query.search}
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
        />
      ) : null}
      {query?.facets.map((facet) => (
        <LibraryFacetMenu
          facet={facet}
          value={computed(() => query.facetValue(facet.id))}
          onChange={(optionId) => query.setFacetValue(facet.id, optionId)}
        />
      ))}
      {query && query.sorts.length > 0 ? (
        <LibrarySortMenu sorts={query.sorts} value={query.sortId} onChange={query.setSortId} />
      ) : null}
      {children}
      {end === undefined ? null : (
        <>
          <span class="cms-library-toolbar__spacer" />
          {end}
        </>
      )}
    </div>
  );
}
