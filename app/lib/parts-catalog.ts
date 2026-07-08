// ─── Junkyard flip-parts catalog ─────────────────────────────────────────────
//
// The parts that actually make money pulled from a junkyard car and resold on eBay.
// This is the heart of the vehicle scanner: for a given car we run each of these
// through eBay sold comps (query = "<year> <make> <model> <term>") and score it, so
// the user sees which parts on THIS specific car are worth pulling.
//
// Each entry carries:
//   • term        — the words appended to the vehicle to form the eBay search.
//   • mustMatch    — token(s) a comp title MUST contain to count (drops cross-part noise;
//                    e.g. an "alternator bracket" shouldn't comp an "alternator").
//   • category    — for grouping/filtering in the UI.
//   • ship        — rough outbound shipping class → drives the default pull-cost/fee model
//                   ('small' fits a padded flat-rate, 'freight' is a bulky body panel).
//   • appliesTo   — optional gate so we don't scan turbo/diesel-only parts on cars that
//                   don't have them (keeps the scan fast + results honest).
//   • note        — surfaced in the UI for parts with caveats (e.g. used-cat rules).

export type PartCategory =
  | 'lighting' | 'engine' | 'electrical' | 'drivetrain' | 'interior' | 'body' | 'wheels' | 'emissions';

export type ShipClass = 'small' | 'medium' | 'large' | 'freight';

export interface PartDef {
  id: string;
  label: string;
  term: string;
  mustMatch: string[];      // at least one must appear in a comp title
  category: PartCategory;
  ship: ShipClass;
  appliesTo?: (v: { turbo?: boolean; bodyClass?: string; drive?: string }) => boolean;
  note?: string;
}

// Default estimated junkyard PULL COST by shipping/size class. This is the "cost" the
// scorer subtracts from eBay net to decide PULL vs SKIP. The user can override a single
// global average in the UI; these per-class defaults just make the first pass sensible.
export const PULL_COST_BY_SHIP: Record<ShipClass, number> = {
  small: 20,
  medium: 30,
  large: 45,
  freight: 65,
};

// Rough outbound shipping cost the scorer uses per class (heavier = eats more margin).
export const SHIP_COST_BY_CLASS: Record<ShipClass, number> = {
  small: 8,
  medium: 14,
  large: 25,
  freight: 90, // freight/LTL for a bumper, door, hood
};

export const PARTS_CATALOG: PartDef[] = [
  // ── Lighting (fast movers, high value on HID/LED) ──
  { id: 'headlight',  label: 'Headlight assembly',  term: 'headlight',         mustMatch: ['headlight', 'headlamp'], category: 'lighting', ship: 'medium' },
  { id: 'taillight',  label: 'Tail light assembly', term: 'tail light',        mustMatch: ['tail'],                  category: 'lighting', ship: 'small' },
  { id: 'foglight',   label: 'Fog lights',          term: 'fog light',         mustMatch: ['fog'],                   category: 'lighting', ship: 'small' },

  // ── Engine bay electrical / mechanical ──
  { id: 'alternator', label: 'Alternator',          term: 'alternator',        mustMatch: ['alternator'],            category: 'engine', ship: 'small' },
  { id: 'starter',    label: 'Starter motor',       term: 'starter motor',     mustMatch: ['starter'],               category: 'engine', ship: 'small' },
  { id: 'ecu',        label: 'ECU / ECM / PCM',     term: 'ecu ecm pcm engine computer', mustMatch: ['ecu', 'ecm', 'pcm', 'computer', 'module'], category: 'electrical', ship: 'small', note: 'Engine/trim-specific — match the part number if you can.' },
  { id: 'accomp',     label: 'A/C compressor',      term: 'ac compressor',     mustMatch: ['compressor'],            category: 'engine', ship: 'medium' },
  { id: 'pspump',     label: 'Power steering pump', term: 'power steering pump', mustMatch: ['steering'],             category: 'engine', ship: 'small' },
  { id: 'throttle',   label: 'Throttle body',       term: 'throttle body',     mustMatch: ['throttle'],              category: 'engine', ship: 'small' },
  { id: 'maf',        label: 'Mass air flow sensor',term: 'mass air flow sensor maf', mustMatch: ['maf', 'mass', 'flow'], category: 'electrical', ship: 'small' },
  { id: 'coils',      label: 'Ignition coils',      term: 'ignition coil',     mustMatch: ['coil'],                  category: 'engine', ship: 'small' },
  { id: 'fuelpump',   label: 'Fuel pump',           term: 'fuel pump',         mustMatch: ['fuel'],                  category: 'engine', ship: 'small' },
  { id: 'turbo',      label: 'Turbocharger',        term: 'turbo turbocharger', mustMatch: ['turbo'],                category: 'engine', ship: 'medium',
    appliesTo: v => !!v.turbo, note: 'High value — only on turbo/forced-induction engines.' },

  // ── Body/chassis control modules ──
  { id: 'abs',        label: 'ABS pump / module',   term: 'abs pump module',   mustMatch: ['abs'],                   category: 'electrical', ship: 'small' },
  { id: 'tcm',        label: 'Transmission module', term: 'transmission control module tcm', mustMatch: ['tcm', 'transmission'], category: 'electrical', ship: 'small' },
  { id: 'bcm',        label: 'Body control module', term: 'body control module bcm', mustMatch: ['bcm', 'module'],   category: 'electrical', ship: 'small' },

  // ── Interior / infotainment (high value on newer cars) ──
  { id: 'radio',      label: 'Radio / infotainment',term: 'radio navigation info display', mustMatch: ['radio', 'navigation', 'display', 'info', 'screen'], category: 'interior', ship: 'small' },
  { id: 'cluster',    label: 'Instrument cluster',  term: 'instrument cluster speedometer', mustMatch: ['cluster', 'speedometer'], category: 'interior', ship: 'small' },
  { id: 'climate',    label: 'Climate/AC control',  term: 'ac climate control panel', mustMatch: ['climate', 'control', 'ac'], category: 'interior', ship: 'small' },
  { id: 'seatbelt',   label: 'Seat belt',           term: 'seat belt',         mustMatch: ['belt'],                  category: 'interior', ship: 'small' },
  { id: 'steering',   label: 'Steering wheel',      term: 'steering wheel',    mustMatch: ['steering', 'wheel'],     category: 'interior', ship: 'small' },
  { id: 'seat',       label: 'Seats (leather)',     term: 'seat',              mustMatch: ['seat'],                  category: 'interior', ship: 'freight', note: 'Only worth it for leather/powered seats.' },

  // ── Mirrors / glass / exterior small ──
  { id: 'mirror',     label: 'Side mirror',         term: 'side mirror',       mustMatch: ['mirror'],                category: 'body', ship: 'small' },
  { id: 'doorhandle', label: 'Door handle',         term: 'door handle',       mustMatch: ['handle'],                category: 'body', ship: 'small' },
  { id: 'windowreg',  label: 'Window regulator',    term: 'window regulator',  mustMatch: ['regulator'],             category: 'body', ship: 'small' },

  // ── Wheels ──
  { id: 'wheels',     label: 'Wheels / rims (set)', term: 'wheels rims oem set', mustMatch: ['wheel', 'rim', 'rims'], category: 'wheels', ship: 'freight' },

  // ── Body panels (valuable but freight-shipped) ──
  { id: 'grille',     label: 'Front grille',        term: 'grille',            mustMatch: ['grille'],                category: 'body', ship: 'medium' },
  { id: 'fender',     label: 'Fender',              term: 'fender',            mustMatch: ['fender'],                category: 'body', ship: 'large' },
  { id: 'hood',       label: 'Hood',                term: 'hood',              mustMatch: ['hood'],                  category: 'body', ship: 'freight' },
  { id: 'bumper',     label: 'Bumper cover',        term: 'bumper cover',      mustMatch: ['bumper'],                category: 'body', ship: 'large' },
  { id: 'tailgate',   label: 'Tailgate / trunk lid',term: 'tailgate trunk lid liftgate', mustMatch: ['tailgate', 'trunk', 'liftgate', 'lid'], category: 'body', ship: 'freight' },

  // ── Emissions ──
  { id: 'cat',        label: 'Catalytic converter', term: 'catalytic converter', mustMatch: ['catalytic', 'converter'], category: 'emissions', ship: 'medium',
    note: 'eBay restricts some used cats; check local law. Often best sold to a core buyer.' },
];

// Filter the catalog to the parts that apply to a given vehicle.
export function partsForVehicle(v: { turbo?: boolean; bodyClass?: string; drive?: string }): PartDef[] {
  return PARTS_CATALOG.filter(p => !p.appliesTo || p.appliesTo(v));
}
