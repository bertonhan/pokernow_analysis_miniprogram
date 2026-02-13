const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

const TIER_CONFIG = [
  {
    tier: 'S',
    label: '顶级',
    keys: ['AA', 'KK', 'QQ', 'JJ', 'AKs']
  },
  {
    tier: 'A',
    label: '强势',
    keys: ['TT', 'AQs', 'AKo', 'AJs', 'KQs', '99']
  },
  {
    tier: 'B',
    label: '优质',
    keys: ['AQo', 'ATs', 'KJs', 'QJs', 'JTs', 'KQo', '88', '77', 'A5s', 'A4s']
  },
  {
    tier: 'C',
    label: '可玩',
    keys: [
      'AJo', 'KTs', 'QTs', 'J9s', 'T9s', '98s', '87s',
      'A9s', 'A8s', 'KJo', 'QJo', '66', '55', '44', '33', '22'
    ]
  }
]

const RANGE_MAP = {}
let rankCursor = 1

TIER_CONFIG.forEach(item => {
  item.keys.forEach(key => {
    RANGE_MAP[key] = {
      rangeKey: key,
      rangeTier: item.tier,
      rangeLabel: item.label,
      rangeRank: rankCursor++
    }
  })
})

function normalizeRank(raw) {
  if (!raw) return ''
  const up = String(raw).toUpperCase()
  return up === '10' ? 'T' : up
}

function getRangeKey(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return ''

  const c1 = cards[0]
  const c2 = cards[1]
  const r1 = normalizeRank(c1.rank)
  const r2 = normalizeRank(c2.rank)

  if (!r1 || !r2) return ''

  if (r1 === r2) return r1 + r2

  const i1 = RANKS.indexOf(r1)
  const i2 = RANKS.indexOf(r2)
  if (i1 < 0 || i2 < 0) return ''

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
      rangeRank: 999
    }
  }

  if (RANGE_MAP[rangeKey]) return RANGE_MAP[rangeKey]

  return {
    rangeKey: rangeKey,
    rangeTier: 'D',
    rangeLabel: '边缘',
    rangeRank: 900
  }
}

module.exports = {
  getRangeInfo
}
