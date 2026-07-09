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
//   • fit         — how strictly a comp must match the vehicle (see PartFit). Model-specific
//                    parts (lights, panels, trim) use 'model'; brand-shared mechanical /
//                    electrical parts that sellers list by OEM part number use 'crossfit'.
//   • category    — for grouping/filtering in the UI.
//   • ship        — rough outbound shipping class → drives the default pull-cost/fee model
//                   ('small' fits a padded flat-rate, 'freight' is a bulky body panel).
//   • pull        — optional per-part pull-cost override (big-ticket items like an engine
//                   cost far more to pull/handle than the ship-class default implies).
//   • appliesTo   — optional gate so we don't scan drivetrain/turbo-only parts on cars that
//                   don't have them (keeps the scan fast + results honest).
//   • note        — surfaced in the UI for parts with caveats (e.g. used-cat rules).

export type PartCategory =
  | 'lighting' | 'engine' | 'electrical' | 'drivetrain' | 'interior' | 'body' | 'wheels'
  | 'emissions' | 'cooling' | 'hvac' | 'brakes' | 'suspension' | 'exhaust' | 'fuel' | 'glass';

export type ShipClass = 'small' | 'medium' | 'large' | 'freight';

// How a sold comp must match the vehicle to count:
//   'model'    — the title must name the MODEL (or every alphabetic model word). Use for
//                parts whose identity/price is model-specific: lights, body panels, mirrors,
//                interior trim, cluster, wheels.
//   'crossfit' — accept a MODEL **or** MAKE match. Use for brand-shared mechanical/electrical
//                parts that sellers routinely list by OEM part number + make with no model
//                in the title (alternator, starter, A/C compressor, sensors, modules, etc.).
export type PartFit = 'model' | 'crossfit';

export interface PartDef {
  id: string;
  label: string;
  term: string;
  mustMatch: string[];      // at least one must appear in a comp title
  fit?: PartFit;            // default 'model'
  category: PartCategory;
  ship: ShipClass;
  pull?: number;            // override PULL_COST_BY_SHIP for this part
  minPrice?: number;        // drop comps below this $ (floors out cheap accessory noise on
                            // generic-keyword assemblies — a real transmission is never $30)
  exclude?: string[];       // drop a comp whose title contains any of these words (whole-word)
                            // — kills wrong-component collisions a single keyword can't (e.g.
                            // "door" → door HANDLE/PANEL, "wheel hub" → RIM/TIRE sets)
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

// ── Vehicle-fit gates ────────────────────────────────────────────────────────
// These decide whether a drivetrain/body-specific part is even worth scanning. When the
// needed field is UNKNOWN (manual entry with no VIN), we default to INCLUDE — better to
// scan a part that might not apply (it just reads NO MARKET) than to hide a real one.
const has4wd = (v: { drive?: string }) => /4wd|4x4|awd|all.?wheel|4.?wheel|four.?wheel/i.test(v.drive || '');
const notFwd = (v: { drive?: string }) => !/fwd|front.?wheel/i.test(v.drive || ''); // unknown or non-FWD
const isTruckSuvVan = (v: { bodyClass?: string }) => !v.bodyClass || /truck|pickup|suv|sport utility|van|cab|crossover/i.test(v.bodyClass);
const isRoofRackBody = (v: { bodyClass?: string }) => !v.bodyClass || /suv|sport utility|wagon|truck|pickup|van|cab|crossover|hatch/i.test(v.bodyClass);

export const PARTS_CATALOG: PartDef[] = [
  // ── Lighting (fast movers, high value on HID/LED) ──
  { id: 'headlight',  label: 'Headlight assembly',  term: 'headlight',         mustMatch: ['headlight', 'headlamp'], category: 'lighting', ship: 'medium' },
  { id: 'taillight',  label: 'Tail light assembly', term: 'tail light',        mustMatch: ['tail'],                  category: 'lighting', ship: 'small' },
  { id: 'foglight',   label: 'Fog lights',          term: 'fog light',         mustMatch: ['fog'],                   category: 'lighting', ship: 'small' },

  // ── Engine bay electrical / mechanical (cross-fit: listed by part number + make) ──
  { id: 'alternator', label: 'Alternator',          term: 'alternator',        mustMatch: ['alternator'],            category: 'engine', ship: 'small', fit: 'crossfit' },
  { id: 'starter',    label: 'Starter motor',       term: 'starter motor',     mustMatch: ['starter'],               category: 'engine', ship: 'small', fit: 'crossfit' },
  { id: 'ecu',        label: 'ECU / ECM / PCM',     term: 'ecu ecm pcm engine computer', mustMatch: ['ecu', 'ecm', 'pcm', 'computer', 'module'], category: 'electrical', ship: 'small', fit: 'crossfit', note: 'Engine/trim-specific — match the part number if you can.' },
  { id: 'accomp',     label: 'A/C compressor',      term: 'ac compressor',     mustMatch: ['compressor'],            category: 'engine', ship: 'medium', fit: 'crossfit' },
  { id: 'pspump',     label: 'Power steering pump', term: 'power steering pump', mustMatch: ['steering'],             category: 'engine', ship: 'small', fit: 'crossfit' },
  { id: 'throttle',   label: 'Throttle body',       term: 'throttle body',     mustMatch: ['throttle'],              category: 'engine', ship: 'small', fit: 'crossfit' },
  { id: 'maf',        label: 'Mass air flow sensor',term: 'mass air flow sensor maf', mustMatch: ['maf', 'mass', 'flow'], category: 'electrical', ship: 'small', fit: 'crossfit' },
  { id: 'coils',      label: 'Ignition coils',      term: 'ignition coil',     mustMatch: ['coil'],                  category: 'engine', ship: 'small', fit: 'crossfit' },
  { id: 'fuelpump',   label: 'Fuel pump',           term: 'fuel pump',         mustMatch: ['fuel'],                  category: 'fuel', ship: 'small', fit: 'crossfit' },
  { id: 'injectors',  label: 'Fuel injectors (set)',term: 'fuel injectors set',mustMatch: ['injector'],              category: 'fuel', ship: 'small', fit: 'crossfit' },
  { id: 'intake',     label: 'Intake manifold',     term: 'intake manifold',   mustMatch: ['intake', 'manifold'],    category: 'engine', ship: 'medium', fit: 'crossfit', minPrice: 50, exclude: ['gasket', 'sensor', 'runner', 'flap', 'actuator', 'bolt', 'kit', 'boot', 'hose', 'clamp', 'tube', 'seal'] },
  { id: 'exmanifold', label: 'Exhaust manifold / header', term: 'exhaust manifold header', mustMatch: ['manifold', 'header'], category: 'exhaust', ship: 'medium', fit: 'crossfit' },
  { id: 'turbo',      label: 'Turbocharger',        term: 'turbo turbocharger', mustMatch: ['turbo'],                category: 'engine', ship: 'medium', fit: 'crossfit',
    appliesTo: v => !!v.turbo, note: 'High value — only on turbo/forced-induction engines.' },

  // ── Big-ticket assemblies (freight / local pickup; high value) ──
  { id: 'engine',     label: 'Engine / long block', term: 'engine motor assembly', mustMatch: ['engine', 'motor'],  category: 'engine', ship: 'freight', fit: 'crossfit', pull: 250, minPrice: 250, exclude: ['mount', 'mounts', 'harness', 'wiring', 'cover', 'wiper', 'blower', 'washer', 'sensor', 'bracket'], note: 'Match displacement + VIN engine code. Verify mileage; freight/local pickup.' },
  { id: 'transmission', label: 'Transmission (assembly)', term: 'transmission', mustMatch: ['transmission', 'trans'], category: 'drivetrain', ship: 'freight', fit: 'crossfit', pull: 200, minPrice: 250, exclude: ['mount', 'mounts', 'cooler', 'filter', 'pan', 'sensor', 'solenoid', 'gasket', 'module', 'wire', 'wiring', 'harness', 'line', 'lines', 'dipstick', 'switch', 'seal', 'fluid', 'bracket', 'kit'], note: 'Match engine + trans code. Freight/local pickup.' },
  { id: 'transfercase', label: 'Transfer case',     term: 'transfer case',     mustMatch: ['transfer'],              category: 'drivetrain', ship: 'large', fit: 'crossfit', pull: 90, minPrice: 120, exclude: ['motor', 'sensor', 'switch', 'actuator', 'seal', 'gasket', 'chain', 'bearing', 'mount', 'solenoid'], appliesTo: has4wd, note: 'Only on 4WD/AWD vehicles.' },
  { id: 'driveshaft', label: 'Driveshaft',          term: 'driveshaft drive shaft', mustMatch: ['driveshaft'],       category: 'drivetrain', ship: 'large', fit: 'crossfit', minPrice: 60, exclude: ['joint', 'ujoint', 'yoke', 'bearing', 'boot', 'flange', 'seal', 'center', 'carrier', 'coupler'], appliesTo: notFwd },
  { id: 'differential', label: 'Differential / rear end', term: 'differential rear carrier', mustMatch: ['differential', 'carrier'], category: 'drivetrain', ship: 'freight', fit: 'crossfit', pull: 120, minPrice: 150, exclude: ['cover', 'bearing', 'seal', 'gasket', 'mount', 'bushing', 'fluid', 'kit', 'yoke', 'shim'], appliesTo: notFwd, note: 'Rear axle assembly. Freight/local pickup.' },
  { id: 'cvaxle',     label: 'CV axle / half shaft',term: 'cv axle half shaft', mustMatch: ['axle', 'halfshaft'],     category: 'drivetrain', ship: 'medium', fit: 'crossfit' },

  // ── Cooling / HVAC ──
  { id: 'radiator',   label: 'Radiator',            term: 'radiator',          mustMatch: ['radiator'],              category: 'cooling', ship: 'medium', fit: 'crossfit' },
  { id: 'condenser',  label: 'A/C condenser',       term: 'ac condenser',      mustMatch: ['condenser'],             category: 'cooling', ship: 'medium', fit: 'crossfit' },
  { id: 'coolingfan', label: 'Radiator cooling fan',term: 'radiator cooling fan assembly', mustMatch: ['fan'],       category: 'cooling', ship: 'medium', fit: 'crossfit' },
  { id: 'blower',     label: 'Blower motor (HVAC)', term: 'blower motor',      mustMatch: ['blower'],                category: 'hvac', ship: 'small', fit: 'crossfit' },

  // ── Brakes ──
  { id: 'caliper',    label: 'Brake calipers',      term: 'brake caliper',     mustMatch: ['caliper'],               category: 'brakes', ship: 'small', fit: 'crossfit' },
  { id: 'mastercyl',  label: 'Brake master cylinder',term: 'brake master cylinder', mustMatch: ['master'],           category: 'brakes', ship: 'small', fit: 'crossfit' },
  { id: 'brakebooster', label: 'Brake booster',     term: 'brake booster',     mustMatch: ['booster'],               category: 'brakes', ship: 'medium', fit: 'crossfit' },

  // ── Suspension / steering ──
  { id: 'strut',      label: 'Struts / shocks',     term: 'strut shock absorber', mustMatch: ['strut', 'shock'],     category: 'suspension', ship: 'medium', fit: 'crossfit' },
  { id: 'controlarm', label: 'Control arm',         term: 'control arm',       mustMatch: ['arm'],                   category: 'suspension', ship: 'medium', fit: 'crossfit' },
  { id: 'wheelhub',   label: 'Wheel hub / bearing', term: 'wheel hub bearing assembly', mustMatch: ['hub'],          category: 'suspension', ship: 'small', fit: 'crossfit', exclude: ['pair', 'set', '2x', '2pc', '2pcs', '2pcs', 'both', 'kit', 'control', 'arm', 'arms', 'cv', 'axle', 'spacer', 'spacers', 'rim', 'rims', 'hubcap'], note: 'eBay comps skew to NEW pairs — a used single pulls less.' },
  { id: 'steeringrack', label: 'Steering rack / gearbox', term: 'steering rack gearbox', mustMatch: ['rack', 'gearbox'], category: 'suspension', ship: 'large', fit: 'crossfit' },
  { id: 'steeringcol',  label: 'Steering column',   term: 'steering column',   mustMatch: ['column'],                category: 'interior', ship: 'medium' },

  // ── Emissions ──
  { id: 'cat',        label: 'Catalytic converter', term: 'catalytic converter', mustMatch: ['catalytic', 'converter'], category: 'emissions', ship: 'medium', fit: 'crossfit',
    note: 'eBay restricts some used cats; check local law. Often best sold to a core buyer.' },
  { id: 'o2sensor',   label: 'Oxygen (O2) sensors', term: 'oxygen o2 sensor',  mustMatch: ['oxygen', 'o2'],          category: 'emissions', ship: 'small', fit: 'crossfit' },
  { id: 'egr',        label: 'EGR valve',           term: 'egr valve',         mustMatch: ['egr'],                   category: 'emissions', ship: 'small', fit: 'crossfit' },

  // ── Body/chassis control modules (cross-fit: part-number listings) ──
  { id: 'abs',        label: 'ABS pump / module',   term: 'abs pump module',   mustMatch: ['abs'],                   category: 'electrical', ship: 'small', fit: 'crossfit' },
  { id: 'tcm',        label: 'Transmission module', term: 'transmission control module tcm', mustMatch: ['tcm', 'transmission'], category: 'electrical', ship: 'small', fit: 'crossfit' },
  { id: 'bcm',        label: 'Body control module', term: 'body control module bcm', mustMatch: ['bcm', 'module'],   category: 'electrical', ship: 'small', fit: 'crossfit' },
  { id: 'ignition',   label: 'Ignition switch / lock', term: 'ignition switch lock cylinder', mustMatch: ['ignition'], category: 'electrical', ship: 'small', fit: 'crossfit' },
  { id: 'keyfob',     label: 'Key fob / remote',    term: 'key fob remote',    mustMatch: ['fob', 'remote'],         category: 'electrical', ship: 'small', fit: 'crossfit' },
  { id: 'fusebox',    label: 'Fuse box / junction', term: 'fuse box junction block', mustMatch: ['fuse', 'junction'], category: 'electrical', ship: 'small', fit: 'crossfit' },
  { id: 'wipermotor', label: 'Wiper motor',         term: 'wiper motor',       mustMatch: ['wiper'],                 category: 'electrical', ship: 'small', fit: 'crossfit' },

  // ── Interior / infotainment (high value on newer cars; model-specific) ──
  { id: 'radio',      label: 'Radio / infotainment',term: 'radio navigation info display', mustMatch: ['radio', 'navigation', 'display', 'info', 'screen'], category: 'interior', ship: 'small' },
  { id: 'cluster',    label: 'Instrument cluster',  term: 'instrument cluster speedometer', mustMatch: ['cluster', 'speedometer'], category: 'interior', ship: 'small' },
  { id: 'climate',    label: 'Climate/AC control',  term: 'ac climate control panel', mustMatch: ['climate', 'control', 'ac'], category: 'interior', ship: 'small' },
  { id: 'seatbelt',   label: 'Seat belt',           term: 'seat belt',         mustMatch: ['belt'],                  category: 'interior', ship: 'small' },
  { id: 'steering',   label: 'Steering wheel',      term: 'steering wheel',    mustMatch: ['steering', 'wheel'],     category: 'interior', ship: 'small' },
  { id: 'seat',       label: 'Seats (leather)',     term: 'seat',              mustMatch: ['seat'],                  category: 'interior', ship: 'freight', note: 'Only worth it for leather/powered seats.' },
  { id: 'console',    label: 'Center console',      term: 'center console',    mustMatch: ['console'],               category: 'interior', ship: 'medium' },
  { id: 'sunvisor',   label: 'Sun visors (pair)',   term: 'sun visor',         mustMatch: ['visor'],                 category: 'interior', ship: 'small' },

  // ── Mirrors / glass / exterior small ──
  { id: 'mirror',     label: 'Side mirror',         term: 'side mirror',       mustMatch: ['mirror'],                category: 'body', ship: 'small' },
  { id: 'doorhandle', label: 'Door handle',         term: 'door handle',       mustMatch: ['handle'],                category: 'body', ship: 'small' },
  { id: 'windowreg',  label: 'Window regulator',    term: 'window regulator',  mustMatch: ['regulator'],             category: 'body', ship: 'small', fit: 'crossfit' },
  { id: 'sunroof',    label: 'Sunroof / moonroof glass', term: 'sunroof moonroof glass', mustMatch: ['sunroof', 'moonroof'], category: 'glass', ship: 'medium' },

  // ── Wheels ──
  { id: 'wheels',     label: 'Wheels / rims (set)', term: 'wheels rims oem set', mustMatch: ['wheel', 'rim', 'rims'], category: 'wheels', ship: 'freight' },

  // ── Body panels (valuable but freight-shipped; model-specific) ──
  { id: 'grille',     label: 'Front grille',        term: 'grille',            mustMatch: ['grille'],                category: 'body', ship: 'medium' },
  { id: 'fender',     label: 'Fender',              term: 'fender',            mustMatch: ['fender'],                category: 'body', ship: 'large', minPrice: 45, exclude: ['liner', 'flare', 'flares', 'trim', 'molding', 'emblem', 'badge', 'marker', 'light', 'sensor', 'bracket', 'well', 'splash', 'guard', 'extension', 'decal', 'sticker', 'protector', 'vent', 'clip'] },
  { id: 'hood',       label: 'Hood',                term: 'hood',              mustMatch: ['hood'],                  category: 'body', ship: 'freight', minPrice: 90, exclude: ['strut', 'struts', 'latch', 'hinge', 'emblem', 'ornament', 'insulation', 'insulator', 'liner', 'pad', 'scoop', 'vent', 'deflector', 'protector', 'bra', 'release', 'cable', 'prop', 'sensor', 'molding', 'decal', 'sticker'] },
  { id: 'bumper',     label: 'Bumper cover',        term: 'bumper cover',      mustMatch: ['bumper'],                category: 'body', ship: 'large', minPrice: 60, exclude: ['bracket', 'support', 'absorber', 'reinforcement', 'sensor', 'trim', 'molding', 'guard', 'pad', 'emblem', 'license', 'plate', 'clip', 'retainer', 'filler', 'valance', 'lip', 'protector', 'skid'] },
  { id: 'tailgate',   label: 'Tailgate / trunk lid',term: 'tailgate trunk lid liftgate', mustMatch: ['tailgate', 'trunk', 'liftgate', 'lid'], category: 'body', ship: 'freight', minPrice: 80, exclude: ['handle', 'latch', 'cap', 'emblem', 'molding', 'trim', 'cable', 'strut', 'hinge', 'lock', 'actuator', 'protector', 'net', 'step', 'assist', 'sensor', 'camera', 'light', 'lens', 'decal', 'sticker', 'bezel', 'panel'] },
  { id: 'door',       label: 'Door shell (complete)', term: 'door shell',      mustMatch: ['door'],                  category: 'body', ship: 'freight', minPrice: 90, exclude: ['handle', 'panel', 'molding', 'trim', 'switch', 'speaker', 'emblem', 'sticker', 'decal', 'guard', 'protector', 'sill', 'armrest', 'striker', 'weatherstrip', 'latch', 'hinge', 'actuator', 'lock', 'bezel', 'clip', 'reflector'], note: 'Complete door; freight/local pickup.' },
  { id: 'doorpanel',  label: 'Door panel (interior)', term: 'door panel interior trim', mustMatch: ['panel'],        category: 'interior', ship: 'large' },
  { id: 'spoiler',    label: 'Spoiler / wing',      term: 'spoiler wing',      mustMatch: ['spoiler', 'wing'],       category: 'body', ship: 'medium' },
  { id: 'runningboard', label: 'Running boards / steps', term: 'running board side step', mustMatch: ['running', 'step', 'board'], category: 'body', ship: 'freight', appliesTo: isTruckSuvVan },
  { id: 'roofrack',   label: 'Roof rack / rails',   term: 'roof rack rails',   mustMatch: ['rack'],                  category: 'body', ship: 'large', appliesTo: isRoofRackBody },
];

// Filter the catalog to the parts that apply to a given vehicle.
export function partsForVehicle(v: { turbo?: boolean; bodyClass?: string; drive?: string }): PartDef[] {
  return PARTS_CATALOG.filter(p => !p.appliesTo || p.appliesTo(v));
}
