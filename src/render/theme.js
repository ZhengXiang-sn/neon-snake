/** 主题配色。全部为程序化颜色，无外部素材依赖。 */
export const THEMES = {
  neon: {
    id: 'neon',
    name: '霓虹深渊',
    bg: '#04050e',
    bgTint: '#0a1130',
    void: 'rgba(3,4,12,0.86)',
    star: 'rgba(150,220,255,0.75)',
    grid: 'rgba(90,200,255,0.05)',
    ring: '#3fd8ff',
    ringInner: 'rgba(63,216,255,0.10)',
    ringWarn: '#ff4d6d',
    obstacle: '#2a3a63',
    obstacleEdge: '#5f7fc4',
    food: {
      common: '#5ef2c0',
      gold: '#ffd34d',
      gem: '#ff77dd',
    },
    ui: {
      accent: '#3fd8ff',
      accentSoft: 'rgba(63,216,255,0.16)',
      danger: '#ff4d6d',
      text: '#dff2ff',
      muted: '#7c96b8',
      panel: 'rgba(8,14,32,0.82)',
    },
  },
  sunset: {
    id: 'sunset',
    name: '落日熔金',
    bg: '#140610',
    bgTint: '#3a1030',
    void: 'rgba(16,4,14,0.86)',
    star: 'rgba(255,220,190,0.7)',
    grid: 'rgba(255,170,120,0.05)',
    ring: '#ffa53d',
    ringInner: 'rgba(255,165,61,0.10)',
    ringWarn: '#ff3d6e',
    obstacle: '#4a2340',
    obstacleEdge: '#c06a8a',
    food: {
      common: '#ffd06b',
      gold: '#fff0a8',
      gem: '#ff6b9d',
    },
    ui: {
      accent: '#ffa53d',
      accentSoft: 'rgba(255,165,61,0.16)',
      danger: '#ff3d6e',
      text: '#ffeee0',
      muted: '#b08a86',
      panel: 'rgba(28,8,24,0.82)',
    },
  },
  abyss: {
    id: 'abyss',
    name: '深海幽绿',
    bg: '#020d0c',
    bgTint: '#04302c',
    void: 'rgba(1,10,10,0.86)',
    star: 'rgba(160,255,225,0.6)',
    grid: 'rgba(80,255,210,0.045)',
    ring: '#2ff0b8',
    ringInner: 'rgba(47,240,184,0.09)',
    ringWarn: '#ff5a3c',
    obstacle: '#123a38',
    obstacleEdge: '#4fae9f',
    food: {
      common: '#7dffd8',
      gold: '#e8ff8a',
      gem: '#5ad2ff',
    },
    ui: {
      accent: '#2ff0b8',
      accentSoft: 'rgba(47,240,184,0.15)',
      danger: '#ff5a3c',
      text: '#dcfff6',
      muted: '#6f9d95',
      panel: 'rgba(3,22,20,0.82)',
    },
  },
}

export const THEME_LIST = Object.values(THEMES)

export function getTheme(id) {
  return THEMES[id] ?? THEMES.neon
}
