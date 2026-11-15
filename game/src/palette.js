// palette.js — the SOLSPIRE look in one place: a desert solar plant at golden hour.
// Sand and terracotta against a teal dusk sky, one hot orange accent (the spire's
// receiver), amber for the Strikers and cyan for the Sentinels. Every material in
// world.js and every colour in hud.js comes from this table so the scene and the
// interface read as one design.

export const PAL = {
  sky: 0x2e4a5a,          // deep teal dusk overhead
  horizon: 0xf2a65a,      // sunset band at the horizon
  fog: 0xcf9a63,          // warm dust haze
  sun: 0xffd9a8,          // low sun light
  hemiSky: 0x8fb6c9,
  hemiGround: 0x8a5c33,
  sand: 0xd9a05b,
  sandDark: 0xb57e3e,
  asphalt: 0x4c4a48,
  concrete: 0xb8ab98,
  concreteDark: 0x8d8172,
  terracotta: 0xb45a32,
  rust: 0x7c4a2d,
  steel: 0x6d7a80,
  steelDark: 0x3f4a4e,
  mirror: 0xcfe4f2,       // heliostat glass
  mirrorFrame: 0x59636a,
  crate: 0x9a6b3f,
  crateAlt: 0x707a52,     // olive supply crates
  drum: 0x3f6d7a,
  glow: 0xff8c3a,         // spire receiver + accents
  atk: 0xf0a830,          // Strikers amber
  def: 0x35c4d8,          // Sentinels cyan
  ink: 0xf3ead9,          // HUD text on dark
  danger: 0xe5484d,
  good: 0x7fc96b,
};

export const TEAM_COLORS = [PAL.atk, PAL.def];
