// game/src/palette.js: shared GLASSHOUSE colors and conversion helpers.
export const PALETTE = {
  canvas: '#0e1512', surface: '#1a2420', leaf: '#4d7a52', mist: '#8fa89a',
  amber: '#e8a33d', ink: '#eef2e6', red: '#e2543e', teal: '#3fa796',
  concrete: '#2a2f2b', metal: '#3a4148', glass: '#9fc4bd'
};

export const TEAM_COLORS = { pruners: '#e2543e', keepers: '#3fa796' };

export function hexToNumber(hex) {
  return Number.parseInt(hex.replace('#', ''), 16);
}
