/**
 * 生态视觉配方。
 *
 * 早期版本这里只有三套配色，地形、地面、装饰、空气粒子全部共用同一套画法，
 * 于是"换主题"实际观感就是"换滤镜"。现在每个生态是一份完整的视觉配方：
 * 天空层类型、地面纹理、装饰物、空气粒子、障碍物材质各不相同，
 * 与 game/terrain.js 里各自的布局算法配对，形成四种真正不同的场景。
 *
 * 约束：本文件是纯数据 + 纯函数，不引用 DOM —— 单元测试要 import 它来
 * 校验"每个生态都有对应的地形布局"。
 */

export const THEMES = {
  // ------------------------------------------------------------ 霓虹深渊
  neon: {
    id: 'neon',
    name: '霓虹深渊',
    blurb: '星际陨石带 · 散点掩体，靠速度吃饭',
    scene: 'nebula',
    floorKind: 'hex',
    propKind: 'crystal',
    ambientKind: 'motes',
    sky: ['#03040c', '#071033', '#0b1a4a'],
    haze: 'rgba(80,170,255,0.06)',
    layerColors: ['#123', '#1b3f7a', '#2a6fd0', '#5fc8ff'],
    floor: { base: 'rgba(24,52,110,0.30)', line: 'rgba(96,210,255,0.16)' },
    prop: { colors: ['#3fd8ff', '#a06bff', '#35e6ff'], glow: 'rgba(63,216,255,0.30)' },
    ambient: { colors: ['#8fe6ff', '#b58cff', '#5ef2c0'], size: 2.1, speed: 26, alpha: 0.5 },
    obstacle: {
      body: '#212f52',
      lit: 'rgba(64,92,150,0.62)',
      rim: 'rgba(160,208,255,0.52)',
      spot: 'rgba(8,14,30,0.55)',
      edge: '#6f97d8',
      glow: '#3fd8ff',
      shadow: 'rgba(0,0,0,0.55)',
      glowAlpha: 0.09,
    },
    void: 'rgba(3,4,12,0.86)',
    ring: '#3fd8ff',
    ringInner: 'rgba(63,216,255,0.12)',
    ringWarn: '#ff4d6d',
    food: { common: '#5ef2c0', gold: '#ffd34d', gem: '#ff77dd' },
    ui: {
      accent: '#3fd8ff',
      accentSoft: 'rgba(63,216,255,0.16)',
      danger: '#ff4d6d',
      text: '#dff2ff',
      muted: '#7c96b8',
      panel: 'rgba(8,14,32,0.82)',
    },
  },

  // ------------------------------------------------------------ 熔金峡谷
  sunset: {
    id: 'sunset',
    name: '熔金峡谷',
    blurb: '折线峡壁 · 走位靠贴墙穿缝',
    scene: 'dunes',
    floorKind: 'ripple',
    propKind: 'pillar',
    ambientKind: 'embers',
    sky: ['#160511', '#4a1226', '#8a3520'],
    haze: 'rgba(255,150,80,0.07)',
    layerColors: ['#3a0f1e', '#6b2129', '#a94a2a', '#e8833c'],
    floor: { base: 'rgba(120,44,32,0.26)', line: 'rgba(255,170,110,0.14)' },
    prop: { colors: ['#ffa53d', '#ff7a4d', '#ffd06b'], glow: 'rgba(255,150,60,0.28)' },
    ambient: { colors: ['#ffb457', '#ff7a3d', '#ffe9a8'], size: 1.9, speed: -30, alpha: 0.6 },
    obstacle: {
      body: '#43203a',
      lit: 'rgba(122,58,84,0.62)',
      rim: 'rgba(255,196,146,0.44)',
      spot: 'rgba(24,8,20,0.5)',
      edge: '#d08a76',
      glow: '#ff8a3d',
      shadow: 'rgba(0,0,0,0.5)',
      glowAlpha: 0.06,
    },
    void: 'rgba(16,4,12,0.86)',
    ring: '#ffa53d',
    ringInner: 'rgba(255,165,61,0.12)',
    ringWarn: '#ff3d6e',
    food: { common: '#ffd06b', gold: '#fff0a8', gem: '#ff6b9d' },
    ui: {
      accent: '#ffa53d',
      accentSoft: 'rgba(255,165,61,0.16)',
      danger: '#ff3d6e',
      text: '#ffeee0',
      muted: '#b08a86',
      panel: 'rgba(28,8,24,0.82)',
    },
  },

  // ------------------------------------------------------------ 珊瑚礁群
  abyss: {
    id: 'abyss',
    name: '珊瑚礁群',
    blurb: '礁团密布 · 团内可穿，团间留缝',
    scene: 'deep',
    floorKind: 'sand',
    propKind: 'kelp',
    ambientKind: 'bubbles',
    sky: ['#010a0c', '#03201f', '#06403a'],
    haze: 'rgba(80,255,210,0.05)',
    layerColors: ['#03201f', '#0a4a43', '#147a68', '#4fd8bd'],
    floor: { base: 'rgba(20,86,80,0.26)', line: 'rgba(110,255,220,0.13)', glow: 'rgba(80,255,210,0.05)' },
    prop: { colors: ['#2ff0b8', '#5ad2ff', '#7dffd8', '#ff8ad0'], glow: 'rgba(47,240,184,0.28)' },
    ambient: { colors: ['#a8fff0', '#5ad2ff', '#7dffd8'], size: 2.6, speed: -34, alpha: 0.5 },
    obstacle: {
      body: '#123a38',
      lit: 'rgba(34,102,95,0.6)',
      rim: 'rgba(196,255,236,0.46)',
      spot: 'rgba(4,26,24,0.5)',
      edge: '#59c3ae',
      glow: '#2ff0b8',
      shadow: 'rgba(0,0,0,0.5)',
      glowAlpha: 0.07,
    },
    void: 'rgba(1,9,10,0.86)',
    ring: '#2ff0b8',
    ringInner: 'rgba(47,240,184,0.11)',
    ringWarn: '#ff5a3c',
    food: { common: '#7dffd8', gold: '#e8ff8a', gem: '#5ad2ff' },
    ui: {
      accent: '#2ff0b8',
      accentSoft: 'rgba(47,240,184,0.15)',
      danger: '#ff5a3c',
      text: '#dcfff6',
      muted: '#6f9d95',
      panel: 'rgba(3,22,20,0.82)',
    },
  },

  // ------------------------------------------------------------ 冰晶冻原
  crystal: {
    id: 'crystal',
    name: '冰晶冻原',
    blurb: '同心晶柱阵 · 切向穿缝，闸口节奏',
    scene: 'aurora',
    floorKind: 'crack',
    propKind: 'icicle',
    ambientKind: 'snow',
    sky: ['#05071a', '#141a44', '#26306e'],
    haze: 'rgba(170,200,255,0.07)',
    layerColors: ['#1a1f4a', '#2f3a7a', '#5866b8', '#9fb4ff'],
    floor: { base: 'rgba(60,80,160,0.24)', line: 'rgba(190,220,255,0.16)', glow: 'rgba(150,190,255,0.06)' },
    prop: { colors: ['#cfe4ff', '#9fc0ff', '#7fe6ff', '#e6d6ff'], glow: 'rgba(180,215,255,0.32)' },
    ambient: { colors: ['#eaf4ff', '#c8dcff', '#a8f0ff'], size: 2.3, speed: -18, alpha: 0.55 },
    obstacle: {
      body: '#2a3a6e',
      lit: 'rgba(84,112,186,0.66)',
      rim: 'rgba(232,244,255,0.62)',
      spot: 'rgba(10,18,44,0.45)',
      edge: '#a8c8ff',
      glow: '#9fc0ff',
      shadow: 'rgba(4,8,26,0.5)',
      glowAlpha: 0.14,
    },
    void: 'rgba(4,6,20,0.86)',
    ring: '#9fc0ff',
    ringInner: 'rgba(159,192,255,0.12)',
    ringWarn: '#ff6b8a',
    food: { common: '#a8f0ff', gold: '#fff2b8', gem: '#c8a8ff' },
    ui: {
      accent: '#9fc0ff',
      accentSoft: 'rgba(159,192,255,0.16)',
      danger: '#ff6b8a',
      text: '#eaf2ff',
      muted: '#8ba0c8',
      panel: 'rgba(9,12,32,0.82)',
    },
  },
}

export const THEME_LIST = Object.values(THEMES)

export function getTheme(id) {
  return THEMES[id] ?? THEMES.neon
}
