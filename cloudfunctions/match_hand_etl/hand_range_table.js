const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

// 169 组起手牌精细表：基于对随机手牌的 Monte Carlo 权益排序（12000 次采样/手牌）
// rangePercent 表示“累计强度百分位（含当前手牌）”，例如 AA=0.5%、AKs=3.5%、AKo=5.4%
const RANGE_ROWS = [
  { key: 'AA', comboCount: 6, rangeEquity: 85.33, rangePercent: 0.5 },
  { key: 'KK', comboCount: 6, rangeEquity: 82.03, rangePercent: 0.9 },
  { key: 'QQ', comboCount: 6, rangeEquity: 80.35, rangePercent: 1.4 },
  { key: 'JJ', comboCount: 6, rangeEquity: 77.79, rangePercent: 1.8 },
  { key: 'TT', comboCount: 6, rangeEquity: 75.03, rangePercent: 2.3 },
  { key: '99', comboCount: 6, rangeEquity: 72.42, rangePercent: 2.7 },
  { key: '88', comboCount: 6, rangeEquity: 69.35, rangePercent: 3.2 },
  { key: 'AKs', comboCount: 4, rangeEquity: 67.23, rangePercent: 3.5 },
  { key: '77', comboCount: 6, rangeEquity: 66.51, rangePercent: 3.9 },
  { key: 'AJs', comboCount: 4, rangeEquity: 66.27, rangePercent: 4.2 },
  { key: 'AQs', comboCount: 4, rangeEquity: 65.59, rangePercent: 4.5 },
  { key: 'AKo', comboCount: 12, rangeEquity: 65.26, rangePercent: 5.4 },
  { key: 'ATs', comboCount: 4, rangeEquity: 64.52, rangePercent: 5.7 },
  { key: 'AQo', comboCount: 12, rangeEquity: 64.06, rangePercent: 6.6 },
  { key: 'KQs', comboCount: 4, rangeEquity: 63.35, rangePercent: 6.9 },
  { key: 'AJo', comboCount: 12, rangeEquity: 63.34, rangePercent: 7.8 },
  { key: 'A9s', comboCount: 4, rangeEquity: 62.88, rangePercent: 8.1 },
  { key: '66', comboCount: 6, rangeEquity: 62.69, rangePercent: 8.6 },
  { key: 'KJs', comboCount: 4, rangeEquity: 62.59, rangePercent: 8.9 },
  { key: 'KTs', comboCount: 4, rangeEquity: 62.28, rangePercent: 9.2 },
  { key: 'ATo', comboCount: 12, rangeEquity: 61.92, rangePercent: 10.1 },
  { key: 'A8s', comboCount: 4, rangeEquity: 61.58, rangePercent: 10.4 },
  { key: 'KQo', comboCount: 12, rangeEquity: 61.40, rangePercent: 11.3 },
  { key: 'A7s', comboCount: 4, rangeEquity: 61.26, rangePercent: 11.6 },
  { key: 'KJo', comboCount: 12, rangeEquity: 61.19, rangePercent: 12.5 },
  { key: 'A8o', comboCount: 12, rangeEquity: 60.30, rangePercent: 13.4 },
  { key: 'A5s', comboCount: 4, rangeEquity: 60.03, rangePercent: 13.7 },
  { key: 'K9s', comboCount: 4, rangeEquity: 59.94, rangePercent: 14.0 },
  { key: '55', comboCount: 6, rangeEquity: 59.86, rangePercent: 14.5 },
  { key: 'KTo', comboCount: 12, rangeEquity: 59.80, rangePercent: 15.4 },
  { key: 'A9o', comboCount: 12, rangeEquity: 59.72, rangePercent: 16.3 },
  { key: 'QJs', comboCount: 4, rangeEquity: 59.54, rangePercent: 16.6 },
  { key: 'A6s', comboCount: 4, rangeEquity: 59.47, rangePercent: 16.9 },
  { key: 'QTs', comboCount: 4, rangeEquity: 59.23, rangePercent: 17.2 },
  { key: 'A4s', comboCount: 4, rangeEquity: 58.79, rangePercent: 17.5 },
  { key: 'A3s', comboCount: 4, rangeEquity: 58.29, rangePercent: 17.8 },
  { key: 'A7o', comboCount: 12, rangeEquity: 58.26, rangePercent: 18.7 },
  { key: 'QJo', comboCount: 12, rangeEquity: 58.15, rangePercent: 19.6 },
  { key: 'K8s', comboCount: 4, rangeEquity: 57.84, rangePercent: 19.9 },
  { key: 'A2s', comboCount: 4, rangeEquity: 57.73, rangePercent: 20.2 },
  { key: 'A6o', comboCount: 12, rangeEquity: 57.65, rangePercent: 21.1 },
  { key: 'K9o', comboCount: 12, rangeEquity: 57.43, rangePercent: 22.0 },
  { key: 'QTo', comboCount: 12, rangeEquity: 57.30, rangePercent: 22.9 },
  { key: 'K7s', comboCount: 4, rangeEquity: 57.17, rangePercent: 23.2 },
  { key: 'JTs', comboCount: 4, rangeEquity: 57.11, rangePercent: 23.5 },
  { key: 'A5o', comboCount: 12, rangeEquity: 56.96, rangePercent: 24.4 },
  { key: 'A4o', comboCount: 12, rangeEquity: 56.86, rangePercent: 25.3 },
  { key: 'Q9s', comboCount: 4, rangeEquity: 56.70, rangePercent: 25.6 },
  { key: '44', comboCount: 6, rangeEquity: 56.65, rangePercent: 26.1 },
  { key: 'K6s', comboCount: 4, rangeEquity: 56.34, rangePercent: 26.4 },
  { key: 'Q8s', comboCount: 4, rangeEquity: 56.02, rangePercent: 26.7 },
  { key: 'JTo', comboCount: 12, rangeEquity: 55.93, rangePercent: 27.6 },
  { key: 'K8o', comboCount: 12, rangeEquity: 55.81, rangePercent: 28.5 },
  { key: 'K5s', comboCount: 4, rangeEquity: 55.78, rangePercent: 28.8 },
  { key: 'A3o', comboCount: 12, rangeEquity: 55.65, rangePercent: 29.7 },
  { key: 'J9s', comboCount: 4, rangeEquity: 55.35, rangePercent: 30.0 },
  { key: 'A2o', comboCount: 12, rangeEquity: 55.06, rangePercent: 30.9 },
  { key: 'Q9o', comboCount: 12, rangeEquity: 55.04, rangePercent: 31.8 },
  { key: 'K4s', comboCount: 4, rangeEquity: 55.02, rangePercent: 32.1 },
  { key: 'K6o', comboCount: 12, rangeEquity: 54.96, rangePercent: 33.0 },
  { key: 'K7o', comboCount: 12, rangeEquity: 54.69, rangePercent: 33.9 },
  { key: 'K3s', comboCount: 4, rangeEquity: 54.55, rangePercent: 34.2 },
  { key: 'Q6s', comboCount: 4, rangeEquity: 54.43, rangePercent: 34.5 },
  { key: 'Q7s', comboCount: 4, rangeEquity: 54.22, rangePercent: 34.8 },
  { key: 'T9s', comboCount: 4, rangeEquity: 54.02, rangePercent: 35.1 },
  { key: 'K2s', comboCount: 4, rangeEquity: 53.83, rangePercent: 35.4 },
  { key: 'Q8o', comboCount: 12, rangeEquity: 53.74, rangePercent: 36.3 },
  { key: '33', comboCount: 6, rangeEquity: 53.31, rangePercent: 36.8 },
  { key: 'J8s', comboCount: 4, rangeEquity: 53.19, rangePercent: 37.1 },
  { key: 'K5o', comboCount: 12, rangeEquity: 53.18, rangePercent: 38.0 },
  { key: 'K4o', comboCount: 12, rangeEquity: 52.76, rangePercent: 38.9 },
  { key: 'Q7o', comboCount: 12, rangeEquity: 52.71, rangePercent: 39.8 },
  { key: 'J9o', comboCount: 12, rangeEquity: 52.70, rangePercent: 40.7 },
  { key: 'T9o', comboCount: 12, rangeEquity: 52.19, rangePercent: 41.6 },
  { key: 'J7s', comboCount: 4, rangeEquity: 52.13, rangePercent: 41.9 },
  { key: 'K2o', comboCount: 12, rangeEquity: 52.03, rangePercent: 42.8 },
  { key: 'T8s', comboCount: 4, rangeEquity: 51.90, rangePercent: 43.1 },
  { key: 'Q5s', comboCount: 4, rangeEquity: 51.86, rangePercent: 43.4 },
  { key: 'Q3s', comboCount: 4, rangeEquity: 51.46, rangePercent: 43.7 },
  { key: 'K3o', comboCount: 12, rangeEquity: 51.42, rangePercent: 44.6 },
  { key: 'J8o', comboCount: 12, rangeEquity: 51.38, rangePercent: 45.6 },
  { key: 'Q6o', comboCount: 12, rangeEquity: 51.00, rangePercent: 46.5 },
  { key: 'Q4s', comboCount: 4, rangeEquity: 50.86, rangePercent: 46.8 },
  { key: 'J6s', comboCount: 4, rangeEquity: 50.81, rangePercent: 47.1 },
  { key: '98s', comboCount: 4, rangeEquity: 50.40, rangePercent: 47.4 },
  { key: 'Q5o', comboCount: 12, rangeEquity: 50.21, rangePercent: 48.3 },
  { key: 'T8o', comboCount: 12, rangeEquity: 50.18, rangePercent: 49.2 },
  { key: '22', comboCount: 6, rangeEquity: 50.15, rangePercent: 49.6 },
  { key: 'T7s', comboCount: 4, rangeEquity: 50.11, rangePercent: 49.9 },
  { key: 'J5s', comboCount: 4, rangeEquity: 49.99, rangePercent: 50.2 },
  { key: 'Q2s', comboCount: 4, rangeEquity: 49.77, rangePercent: 50.5 },
  { key: 'J7o', comboCount: 12, rangeEquity: 49.56, rangePercent: 51.4 },
  { key: 'J4s', comboCount: 4, rangeEquity: 48.52, rangePercent: 51.7 },
  { key: '97s', comboCount: 4, rangeEquity: 48.50, rangePercent: 52.0 },
  { key: 'J6o', comboCount: 12, rangeEquity: 48.50, rangePercent: 52.9 },
  { key: '98o', comboCount: 12, rangeEquity: 48.43, rangePercent: 53.8 },
  { key: '96s', comboCount: 4, rangeEquity: 48.39, rangePercent: 54.1 },
  { key: 'J3s', comboCount: 4, rangeEquity: 48.27, rangePercent: 54.4 },
  { key: 'T6s', comboCount: 4, rangeEquity: 48.25, rangePercent: 54.8 },
  { key: 'Q3o', comboCount: 12, rangeEquity: 48.10, rangePercent: 55.7 },
  { key: 'Q4o', comboCount: 12, rangeEquity: 48.04, rangePercent: 56.6 },
  { key: 'T7o', comboCount: 12, rangeEquity: 48.02, rangePercent: 57.5 },
  { key: 'Q2o', comboCount: 12, rangeEquity: 47.96, rangePercent: 58.4 },
  { key: '87s', comboCount: 4, rangeEquity: 47.48, rangePercent: 58.7 },
  { key: 'J5o', comboCount: 12, rangeEquity: 47.06, rangePercent: 59.6 },
  { key: 'J2s', comboCount: 4, rangeEquity: 46.85, rangePercent: 59.9 },
  { key: 'T5s', comboCount: 4, rangeEquity: 46.68, rangePercent: 60.2 },
  { key: '86s', comboCount: 4, rangeEquity: 46.50, rangePercent: 60.5 },
  { key: 'J4o', comboCount: 12, rangeEquity: 46.41, rangePercent: 61.4 },
  { key: 'T4s', comboCount: 4, rangeEquity: 46.37, rangePercent: 61.7 },
  { key: '97o', comboCount: 12, rangeEquity: 46.31, rangePercent: 62.6 },
  { key: '76s', comboCount: 4, rangeEquity: 46.15, rangePercent: 62.9 },
  { key: '95s', comboCount: 4, rangeEquity: 45.93, rangePercent: 63.2 },
  { key: 'T6o', comboCount: 12, rangeEquity: 45.78, rangePercent: 64.1 },
  { key: 'T3s', comboCount: 4, rangeEquity: 45.60, rangePercent: 64.4 },
  { key: 'T2s', comboCount: 4, rangeEquity: 45.60, rangePercent: 64.7 },
  { key: '85s', comboCount: 4, rangeEquity: 44.83, rangePercent: 65.0 },
  { key: 'J2o', comboCount: 12, rangeEquity: 44.42, rangePercent: 65.9 },
  { key: 'T5o', comboCount: 12, rangeEquity: 44.39, rangePercent: 66.8 },
  { key: '75s', comboCount: 4, rangeEquity: 44.23, rangePercent: 67.1 },
  { key: '87o', comboCount: 12, rangeEquity: 44.20, rangePercent: 68.0 },
  { key: 'T4o', comboCount: 12, rangeEquity: 44.05, rangePercent: 68.9 },
  { key: 'J3o', comboCount: 12, rangeEquity: 44.04, rangePercent: 69.8 },
  { key: '96o', comboCount: 12, rangeEquity: 43.92, rangePercent: 70.7 },
  { key: '94s', comboCount: 4, rangeEquity: 43.75, rangePercent: 71.0 },
  { key: '93s', comboCount: 4, rangeEquity: 43.35, rangePercent: 71.3 },
  { key: '76o', comboCount: 12, rangeEquity: 43.17, rangePercent: 72.2 },
  { key: '65s', comboCount: 4, rangeEquity: 43.05, rangePercent: 72.5 },
  { key: '95o', comboCount: 12, rangeEquity: 42.64, rangePercent: 73.5 },
  { key: '84s', comboCount: 4, rangeEquity: 42.57, rangePercent: 73.8 },
  { key: '74s', comboCount: 4, rangeEquity: 42.50, rangePercent: 74.1 },
  { key: '86o', comboCount: 12, rangeEquity: 42.49, rangePercent: 75.0 },
  { key: 'T2o', comboCount: 12, rangeEquity: 42.37, rangePercent: 75.9 },
  { key: 'T3o', comboCount: 12, rangeEquity: 42.33, rangePercent: 76.8 },
  { key: '92s', comboCount: 4, rangeEquity: 42.18, rangePercent: 77.1 },
  { key: '54s', comboCount: 4, rangeEquity: 41.34, rangePercent: 77.4 },
  { key: '83s', comboCount: 4, rangeEquity: 41.07, rangePercent: 77.7 },
  { key: '85o', comboCount: 12, rangeEquity: 40.98, rangePercent: 78.6 },
  { key: '64s', comboCount: 4, rangeEquity: 40.44, rangePercent: 78.9 },
  { key: '75o', comboCount: 12, rangeEquity: 40.22, rangePercent: 79.8 },
  { key: '53s', comboCount: 4, rangeEquity: 40.17, rangePercent: 80.1 },
  { key: '94o', comboCount: 12, rangeEquity: 40.17, rangePercent: 81.0 },
  { key: '82s', comboCount: 4, rangeEquity: 40.14, rangePercent: 81.3 },
  { key: '65o', comboCount: 12, rangeEquity: 39.78, rangePercent: 82.2 },
  { key: '73s', comboCount: 4, rangeEquity: 39.77, rangePercent: 82.5 },
  { key: '63s', comboCount: 4, rangeEquity: 39.57, rangePercent: 82.8 },
  { key: '93o', comboCount: 12, rangeEquity: 39.57, rangePercent: 83.7 },
  { key: '84o', comboCount: 12, rangeEquity: 39.08, rangePercent: 84.6 },
  { key: '92o', comboCount: 12, rangeEquity: 38.82, rangePercent: 85.5 },
  { key: '74o', comboCount: 12, rangeEquity: 38.57, rangePercent: 86.4 },
  { key: '43s', comboCount: 4, rangeEquity: 38.28, rangePercent: 86.7 },
  { key: '83o', comboCount: 12, rangeEquity: 38.05, rangePercent: 87.6 },
  { key: '54o', comboCount: 12, rangeEquity: 37.86, rangePercent: 88.5 },
  { key: '62s', comboCount: 4, rangeEquity: 37.81, rangePercent: 88.8 },
  { key: '52s', comboCount: 4, rangeEquity: 37.70, rangePercent: 89.1 },
  { key: '72s', comboCount: 4, rangeEquity: 37.60, rangePercent: 89.4 },
  { key: '64o', comboCount: 12, rangeEquity: 37.27, rangePercent: 90.3 },
  { key: '63o', comboCount: 12, rangeEquity: 37.07, rangePercent: 91.3 },
  { key: '82o', comboCount: 12, rangeEquity: 37.01, rangePercent: 92.2 },
  { key: '73o', comboCount: 12, rangeEquity: 36.81, rangePercent: 93.1 },
  { key: '42s', comboCount: 4, rangeEquity: 36.33, rangePercent: 93.4 },
  { key: '53o', comboCount: 12, rangeEquity: 36.01, rangePercent: 94.3 },
  { key: '32s', comboCount: 4, rangeEquity: 35.93, rangePercent: 94.6 },
  { key: '43o', comboCount: 12, rangeEquity: 35.25, rangePercent: 95.5 },
  { key: '72o', comboCount: 12, rangeEquity: 34.98, rangePercent: 96.4 },
  { key: '52o', comboCount: 12, rangeEquity: 34.55, rangePercent: 97.3 },
  { key: '42o', comboCount: 12, rangeEquity: 34.06, rangePercent: 98.2 },
  { key: '62o', comboCount: 12, rangeEquity: 33.68, rangePercent: 99.1 },
  { key: '32o', comboCount: 12, rangeEquity: 32.57, rangePercent: 100.0 },
]

const RANGE_MAP = {}

RANGE_ROWS.forEach((row, idx) => {
  const bucket = (function pickBucket(percent) {
    if (percent <= 5.0) return { tier: 'S', label: '顶级' }
    if (percent <= 12.0) return { tier: 'A', label: '强势' }
    if (percent <= 25.0) return { tier: 'B', label: '可玩' }
    if (percent <= 40.0) return { tier: 'C', label: '边缘' }
    return { tier: 'D', label: '弱势' }
  })(row.rangePercent)

  RANGE_MAP[row.key] = {
    rangeKey: row.key,
    rangeTier: bucket.tier,
    rangeLabel: bucket.label,
    rangeRank: idx + 1,
    rangePercent: row.rangePercent,
    rangeEquity: row.rangeEquity,
    comboCount: row.comboCount
  }
})

function normalizeRank(raw) {
  if (!raw) return ''
  const up = String(raw).toUpperCase()
  return up === '10' ? 'T' : up
}

function getRangeKey(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return ""

  const c1 = cards[0]
  const c2 = cards[1]
  const r1 = normalizeRank(c1.rank)
  const r2 = normalizeRank(c2.rank)

  if (!r1 || !r2) return ""

  if (r1 === r2) return r1 + r2

  const i1 = RANKS.indexOf(r1)
  const i2 = RANKS.indexOf(r2)
  if (i1 < 0 || i2 < 0) return ""

  const high = i1 < i2 ? r1 : r2
  const low = i1 < i2 ? r2 : r1
  const suited = c1.suit && c2.suit && c1.suit === c2.suit
  return high + low + (suited ? 's' : 'o')
}

function getRangeInfo(cards) {
  const rangeKey = getRangeKey(cards)
  if (!rangeKey) {
    return {
      rangeKey: '',
      rangeTier: 'UNKNOWN',
      rangeLabel: '未知',
      rangeRank: 999,
      rangePercent: 100,
      rangeEquity: 0,
      comboCount: 0
    }
  }

  if (RANGE_MAP[rangeKey]) return RANGE_MAP[rangeKey]

  return {
    rangeKey: rangeKey,
    rangeTier: 'D',
    rangeLabel: '弱势',
    rangeRank: 900,
    rangePercent: 100,
    rangeEquity: 0,
    comboCount: 0
  }
}

module.exports = {
  getRangeInfo
}