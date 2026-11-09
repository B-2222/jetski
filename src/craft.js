// Craft presets. Numbers come from RESEARCH.md (spec sheets, magazine tests).
// Where no source gave a number the value is an engineering estimate, marked "est".
//
// Body frame used everywhere: +z = forward (bow), +y = up, +x = LEFT (port).
// So the rider's right-hand side is -x.

export const TRIM_RANGES = {
  stock: { label: 'Stock VTS', min: -6, max: 6 },
  extended: { label: 'Extended VTS', min: -8, max: 9 },
  trixx: { label: 'Trixx VTS', min: -6, max: 17 },
  max: { label: 'MAX TRIM (mod)', min: -10, max: 30 },
};

export const CRAFTS = {
  rxpx325: {
    id: 'rxpx325',
    name: 'RXP-X 325',
    hullName: 'T3-R race hull',
    blurb: '325 hp supercharged. Narrow T3-R hull that leans hard and carves. Ergolock seat.',
    // mass
    massBase: 363,            // kg: 353 dry + oil, battery, coolant (spec sheet + est)
    fuelCapacityL: 70,        // L (spec sheet)
    // hull geometry
    length: 3.32,             // m (spec sheet)
    beam: 1.25,               // m (spec sheet)
    chineBeam: 1.06,          // m planing bottom width at the chines (est)
    deadrise: 22,             // deg at transom (est, T3-R is a deep V)
    hullLatGrip: 0.75,        // how much the V-bottom resists side slip (tuning)
    slideGrip: 0.5,          // fraction of hull side grip left once it is skating sideways (tuned)
    steerAngle: 25,
    sternGrip: 0.5,
    critTrim: 5,           // deg running trim where porpoising starts (est)
    porpoiseGain: 900,       // how hard it porpoises past that (tuned)
    porpoiseCap: 720,        // Nm limit on the porpoising drive (tuned)
    popPower: 1.3,           // freestyle pop strength (game tuning)
    blipKick: 1.0,            // how much a throttle blip loosens the stern (game tuning)
    keelArea: 0.011,        // m^2 side-force element (est, tuned)
    pumpArea: 0.003,
    sideForceDrop: 0.05,     // m: hull side force acts this far below the CG (est)
    sponsonArea: 0.018,        // m^2 per sponson (est)
    sponsonDrop: 0.035,       // m below the chine at the middle setting (est)
    cgBase: [0, 0.0, -0.5], // hull CG in body frame (est: engine low, aft of middle, balanced over the centre of buoyancy)
    inertia: [95, 430, 410],  // roll, yaw, pitch kg m^2 about hull CG (est)
    // engine: Rotax 1630 ACE 325
    powerKW: 239,             // 325 hp
    rpmPeakPower: 8000,
    rpmLimit: 8250,           // rev limiter (Jet Drift)
    rpmIdle: 1700,
    engineInertia: 0.11,      // kg m^2 crank + supercharger + impeller (est)
    // pump: 161 mm, 4 blade stainless impeller (parts retailers)
    nozzleDia: 0.098,         // m nozzle exit (est)
    staticThrust: 6900,       // N at full rpm, standstill (est from momentum theory)
    jetSpeedTop: 57,          // m/s jet velocity at the limiter (tuned for top speed)
    cavitation: 0.38,         // thrust lost when the pump cavitates on a hard launch
    speedLimit: 31.1,         // m/s ECU limiter, about 69.5 mph (Boating Mag test 68.5 mph)
    trimRanges: ['extended', 'stock', 'max'],
    hasLaunchControl: true,
    fuelBurnWOT: 22,          // US gal/h at full throttle (Jet Drift)
    color: { deck: 0xf2c200, accent: 0x15171a, hull: 0xe9ecef, seat: 0x1d1f22, trim: 0x8a8f96 },
    shape: 'rxp',
  },
  gti130: {
    id: 'gti130',
    name: 'GTI SE 130 (2012)',
    hullName: 'GTI recreation hull',
    blurb: '130 hp naturally aspirated 1503. Wide, forgiving, friendly hull. The test ski.',
    massBase: 352,            // kg (est, about 765 lb dry plus fluids)
    fuelCapacityL: 60,
    length: 3.37,
    beam: 1.22,
    chineBeam: 1.04,
    deadrise: 18,
    hullLatGrip: 0.8,
    slideGrip: 0.5,
    steerAngle: 23,
    sternGrip: 0.6,
    critTrim: 5.5,           // deg running trim where porpoising starts (est)
    porpoiseGain: 300,       // how hard it porpoises past that (tuned)
    porpoiseCap: 300,        // Nm limit on the porpoising drive (tuned)
    popPower: 1.35,           // freestyle pop strength (game tuning)
    blipKick: 1.1,             // how much a throttle blip loosens the stern (game tuning)
    keelArea: 0.009,
    pumpArea: 0.0025,
    sideForceDrop: 0.07,
    sponsonArea: 0.006,
    sponsonDrop: 0.015,
    cgBase: [0, 0.0, -0.5],
    inertia: [92, 420, 400],
    powerKW: 97,              // 130 hp
    rpmPeakPower: 7300,
    rpmLimit: 7400,
    rpmIdle: 1700,
    engineInertia: 0.07,
    nozzleDia: 0.09,
    staticThrust: 4100,
    jetSpeedTop: 36.5,
    cavitation: 0.25,
    speedLimit: 99,           // too slow to need the limiter
    trimRanges: ['stock', 'extended', 'max'],
    hasLaunchControl: false,
    fuelBurnWOT: 10,
    color: { deck: 0x1b4fd6, accent: 0xf4f6f8, hull: 0xeef1f4, seat: 0x23262b, trim: 0x9aa0a8 },
    shape: 'gti',
  },
  spark90: {
    id: 'spark90',
    name: 'Spark Trixx 90',
    hullName: 'Polytec Spark hull',
    blurb: '90 hp Rotax 900 ACE. About 200 kg, loose and flickable. Trixx VTS goes to +17 degrees.',
    massBase: 206,            // kg 201 dry + fluids (dealer spec)
    fuelCapacityL: 30,
    length: 2.79,
    beam: 1.18,
    chineBeam: 0.98,
    deadrise: 16,
    hullLatGrip: 0.6,
    slideGrip: 0.4,
    steerAngle: 25,
    sternGrip: 0.3,
    critTrim: 5,           // deg running trim where porpoising starts (est)
    porpoiseGain: 600,       // how hard it porpoises past that (tuned)
    porpoiseCap: 330,        // Nm limit on the porpoising drive (tuned)
    popPower: 1.75,          // freestyle pop strength (game tuning)
    blipKick: 0.7,            // how much a throttle blip loosens the stern (game tuning)
    keelArea: 0.0065,
    pumpArea: 0.002,
    sideForceDrop: 0.07,
    sponsonArea: 0.0015,
    sponsonDrop: 0.0,
    cgBase: [0, 0.0, -0.42],
    inertia: [48, 190, 180],
    powerKW: 67,              // 90 hp
    rpmPeakPower: 8000,
    rpmLimit: 8100,
    rpmIdle: 1600,
    engineInertia: 0.045,
    nozzleDia: 0.078,
    staticThrust: 3000,
    jetSpeedTop: 33.5,
    cavitation: 0.25,
    speedLimit: 99,
    trimRanges: ['trixx', 'stock', 'max'],
    hasLaunchControl: false,
    fuelBurnWOT: 7,
    color: { deck: 0xff6a1a, accent: 0x111316, hull: 0xf2f2f2, seat: 0x202226, trim: 0x2b2e33 },
    shape: 'spark',
  },
};

export const RIDING_MODES = {
  sport: { label: 'SPORT', response: 9, curve: 1.0, rpmCap: 1.0 },
  touring: { label: 'TOURING', response: 3.2, curve: 1.6, rpmCap: 1.0 },
  eco: { label: 'ECO', response: 2.5, curve: 1.3, rpmCap: 0.71 },
};
