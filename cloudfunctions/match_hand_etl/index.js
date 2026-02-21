const cloud = require('wx-server-sdk')
const { getRangeInfo } = require('./hand_range_table')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const FACT_COLLECTION = 'match_hand_facts'

const RANK_VALUE_MAP = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
}

const SUIT_NORMALIZE_MAP = {
  s: 'S',
  h: 'H',
  d: 'D',
  c: 'C',
  '♠': 'S',
  '♥': 'H',
  '♦': 'D',
  '♣': 'C'
}

const SUIT_SYMBOL_MAP = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣'
}

function round(value, digits) {
  if (typeof value !== 'number' || isNaN(value)) return null
  const factor = Math.pow(10, digits || 2)
  return Math.round(value * factor) / factor
}

function toNumber(input) {
  if (input === null || input === undefined) return null
  const normalized = String(input).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return isNaN(parsed) ? null : parsed
}

function parsePlayerInfo(rawString) {
  const clean = String(rawString || '').replace(/"/g, '').trim()
  const parts = clean.split('@')
  if (parts.length > 1) {
    return {
      name: parts[0].trim(),
      id: parts[1].trim()
    }
  }
  return {
    name: clean,
    id: clean
  }
}

function normalizeCardToken(token) {
  const raw = String(token || '').replace(/[\[\],]/g, '').trim()
  if (!raw) return null

  const match = raw.match(/^(10|[2-9TJQKA])([shdc♠♥♦♣])$/i)
  if (!match) return null

  const rankRaw = match[1].toUpperCase()
  const suitRaw = match[2]
  const rank = rankRaw === '10' ? 'T' : rankRaw
  const suit = SUIT_NORMALIZE_MAP[suitRaw.toLowerCase()] || SUIT_NORMALIZE_MAP[suitRaw] || ''
  if (!rank || !suit) return null

  return {
    rank: rank,
    suit: suit,
    value: RANK_VALUE_MAP[rank] || 0,
    text: rank + (SUIT_SYMBOL_MAP[suit] || suit)
  }
}

function extractCardsFromText(text) {
  const msg = String(text || '')
  const tokens = msg.match(/10[shdc♠♥♦♣]|[2-9TJQKA][shdc♠♥♦♣]/gi) || []
  const cards = []
  tokens.forEach(token => {
    const parsed = normalizeCardToken(token)
    if (parsed) cards.push(parsed)
  })
  return cards
}

function parseStreet(msg, currentStreet) {
  const text = String(msg || '')
  if (/^Flop\b/i.test(text)) return 'FLOP'
  if (/^Turn\b/i.test(text)) return 'TURN'
  if (/^River\b/i.test(text)) return 'RIVER'
  return currentStreet
}

function parseButtonPlayer(msg) {
  const text = String(msg || '')
  if (!/button|dealer/i.test(text)) return ''
  const quoted = text.match(/"(.*?)"/)
  if (!quoted) return ''
  const info = parsePlayerInfo(quoted[1])
  if (!info.id || info.id === 'admin' || info.id === 'game') return ''
  return info.id
}

function parseAmount(msg, action) {
  const text = String(msg || '')
  if (!text) {
    return { amount: 0, toAmount: null }
  }

  if (action === 'raises') {
    const toMatch = text.match(/rais(?:e|es|ed)(?:\s+\w+)?\s+to\s+([0-9][0-9,]*(?:\.[0-9]+)?)/i)
    if (toMatch) {
      const toAmount = toNumber(toMatch[1])
      return {
        amount: toAmount || 0,
        toAmount: toAmount
      }
    }
  }

  const specific = text.match(/(?:post|posts|posted|call|calls|called|bet|bets|raise|raises|raised)(?:\s+an?)?(?:\s+small|\s+big)?(?:\s+blind)?(?:\s+of)?\s+([0-9][0-9,]*(?:\.[0-9]+)?)/i)
  if (specific) {
    return {
      amount: toNumber(specific[1]) || 0,
      toAmount: null
    }
  }

  const generic = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/)
  return {
    amount: generic ? (toNumber(generic[1]) || 0) : 0,
    toAmount: null
  }
}

function parseAction(log, street) {
  const msg = String((log && log.msg) || '')
  const match = msg.match(/"(.*?)"\s+(posts?|posted|calls?|called|bets?|raises?|raised|checks?|checked|folds?|folded|shows?|showed|collected|wins?|won)/i)
  if (!match) return null

  const info = parsePlayerInfo(match[1])
  const rawAction = match[2].toLowerCase()
  let action = rawAction
  if (rawAction === 'post' || rawAction === 'posts' || rawAction === 'posted') action = 'posts'
  else if (rawAction === 'call' || rawAction === 'calls' || rawAction === 'called') action = 'calls'
  else if (rawAction === 'bet' || rawAction === 'bets') action = 'bets'
  else if (rawAction === 'raise' || rawAction === 'raises' || rawAction === 'raised') action = 'raises'
  else if (rawAction === 'check' || rawAction === 'checks' || rawAction === 'checked') action = 'checks'
  else if (rawAction === 'fold' || rawAction === 'folds' || rawAction === 'folded') action = 'folds'
  else if (rawAction === 'show' || rawAction === 'shows' || rawAction === 'showed') action = 'shows'
  else if (rawAction === 'win' || rawAction === 'wins' || rawAction === 'won' || rawAction === 'collected') action = 'collected'

  if (!info.id || info.id === 'admin' || info.id === 'game') return null

  const amountData = parseAmount(msg, action)
  return {
    playerId: info.id,
    playerName: info.name || info.id,
    action: action,
    street: street,
    amount: amountData.amount || 0,
    toAmount: amountData.toAmount,
    isAllIn: /all[\s-]?in/i.test(msg),
    msg: msg
  }
}

function parseStackFromMessage(msg, playerId) {
  const text = String(msg || '')
  if (!/stack/i.test(text)) return null
  if (!playerId) return null
  const amountMatch = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/)
  if (!amountMatch) return null
  return toNumber(amountMatch[1])
}

function parseStructuredStacks(log) {
  const stacks = {}
  if (!log || typeof log !== 'object') return stacks

  const candidateKeys = ['stacks', 'playerStacks', 'playersStacks', 'stackMap']
  candidateKeys.forEach(key => {
    const val = log[key]
    if (!val || typeof val !== 'object') return

    Object.keys(val).forEach(pid => {
      const amount = toNumber(val[pid])
      if (amount !== null) stacks[pid] = amount
    })
  })

  return stacks
}

function parsePlayerStacksLine(msg) {
  const text = String(msg || '')
  if (!/player\s*stacks?/i.test(text)) return {}

  const stacks = {}
  const regex = /"(.*?)"\s*\(([^)]+)\)/g
  let match = regex.exec(text)
  while (match) {
    const info = parsePlayerInfo(match[1])
    const amount = toNumber(match[2])
    if (info && info.id && amount !== null) stacks[info.id] = amount
    match = regex.exec(text)
  }
  return stacks
}

function getStreetActionStore(store, playerId) {
  if (!store[playerId]) {
    store[playerId] = {
      PREFLOP: [],
      FLOP: [],
      TURN: [],
      RIVER: []
    }
  }
  return store[playerId]
}

function actionToText(action, amount, toAmount) {
  if (action === 'raises' && toAmount) return 'raises to ' + toAmount
  if ((action === 'posts' || action === 'calls' || action === 'bets' || action === 'raises') && amount) {
    return action + ' ' + amount
  }
  return action
}

function buildMiddlePositions(count) {
  if (count <= 0) return []
  if (count === 1) return ['枪口']
  if (count === 2) return ['枪口', '前置位']
  if (count === 3) return ['枪口', '前置位', '后置位']

  let epCount = 1
  let lpCount = 1
  let filled = 3
  while (filled < count) {
    epCount += 1
    filled += 1
    if (filled < count) {
      lpCount += 1
      filled += 1
    }
  }

  const result = ['枪口']
  for (let i = 0; i < epCount; i += 1) result.push('前置位')
  for (let i = 0; i < lpCount; i += 1) result.push('后置位')
  return result
}

function assignPositions(allPlayers, sbPid, bbPid, buttonPid, preflopOrder) {
  const positions = {}
  const excluded = {}

  if (sbPid) {
    positions[sbPid] = '小盲'
    excluded[sbPid] = true
  }
  if (bbPid) {
    if (positions[bbPid] === '小盲') positions[bbPid] = '小盲/大盲'
    else positions[bbPid] = '大盲'
    excluded[bbPid] = true
  }

  const ordered = []
  const seen = {}
  ;(preflopOrder || []).forEach(pid => {
    if (!pid || excluded[pid]) return
    if (!seen[pid]) {
      seen[pid] = true
      ordered.push(pid)
    }
  })

  ;(allPlayers || []).forEach(pid => {
    if (!pid || excluded[pid]) return
    if (!seen[pid]) {
      seen[pid] = true
      ordered.push(pid)
    }
  })

  let finalButton = buttonPid
  if (!finalButton || excluded[finalButton]) {
    finalButton = ordered.length > 0 ? ordered[ordered.length - 1] : ''
  }

  const middlePlayers = ordered.filter(pid => pid !== finalButton)
  const middleLabels = buildMiddlePositions(middlePlayers.length)

  middlePlayers.forEach((pid, idx) => {
    positions[pid] = middleLabels[idx] || '前置位'
  })
  if (finalButton) positions[finalButton] = '庄位'

  ;(allPlayers || []).forEach(pid => {
    if (!positions[pid]) positions[pid] = '后置位'
  })

  return positions
}

function getStraightHigh(uniqueRanksDesc) {
  if (!Array.isArray(uniqueRanksDesc) || uniqueRanksDesc.length < 5) return 0
  const ranks = uniqueRanksDesc.slice()
  if (ranks[0] === 14) ranks.push(1)

  for (let i = 0; i <= ranks.length - 5; i += 1) {
    let ok = true
    for (let j = 0; j < 4; j += 1) {
      if (ranks[i + j] - 1 !== ranks[i + j + 1]) {
        ok = false
        break
      }
    }
    if (ok) return ranks[i] === 1 ? 5 : ranks[i]
  }
  return 0
}

function evaluateFive(cards) {
  const ranks = cards.map(c => c.value).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)
  const isFlush = suits.every(s => s === suits[0])

  const rankCount = {}
  ranks.forEach(r => {
    rankCount[r] = (rankCount[r] || 0) + 1
  })

  const uniqueRanks = Object.keys(rankCount).map(Number).sort((a, b) => b - a)
  const straightHigh = getStraightHigh(uniqueRanks)

  if (isFlush && straightHigh > 0) {
    return {
      category: 8,
      kickers: [straightHigh],
      label: straightHigh === 14 ? '皇家同花顺' : '同花顺'
    }
  }

  const groups = uniqueRanks
    .map(rank => ({ rank: rank, count: rankCount[rank] }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return b.rank - a.rank
    })

  if (groups[0].count === 4) {
    return {
      category: 7,
      kickers: [groups[0].rank, groups[1].rank],
      label: '四条'
    }
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return {
      category: 6,
      kickers: [groups[0].rank, groups[1].rank],
      label: '葫芦'
    }
  }

  if (isFlush) {
    return {
      category: 5,
      kickers: ranks,
      label: '同花'
    }
  }

  if (straightHigh > 0) {
    return {
      category: 4,
      kickers: [straightHigh],
      label: '顺子'
    }
  }

  if (groups[0].count === 3) {
    const remain = groups.filter(item => item.count === 1).map(item => item.rank).sort((a, b) => b - a)
    return {
      category: 3,
      kickers: [groups[0].rank].concat(remain),
      label: '三条'
    }
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairRanks = [groups[0].rank, groups[1].rank].sort((a, b) => b - a)
    const kicker = groups.filter(item => item.count === 1).map(item => item.rank)[0] || 0
    return {
      category: 2,
      kickers: pairRanks.concat([kicker]),
      label: '两对'
    }
  }

  if (groups[0].count === 2) {
    const remain = groups.filter(item => item.count === 1).map(item => item.rank).sort((a, b) => b - a)
    return {
      category: 1,
      kickers: [groups[0].rank].concat(remain),
      label: '一对'
    }
  }

  return {
    category: 0,
    kickers: ranks,
    label: '高牌'
  }
}

function compareEval(a, b) {
  if (a.category !== b.category) return a.category - b.category
  const len = Math.max(a.kickers.length, b.kickers.length)
  for (let i = 0; i < len; i += 1) {
    const av = a.kickers[i] || 0
    const bv = b.kickers[i] || 0
    if (av !== bv) return av - bv
  }
  return 0
}

function pickFive(cards, start, picked, out) {
  if (picked.length === 5) {
    out.push(picked.slice())
    return
  }
  for (let i = start; i < cards.length; i += 1) {
    picked.push(cards[i])
    pickFive(cards, i + 1, picked, out)
    picked.pop()
  }
}

function evaluateBest(cards) {
  if (!Array.isArray(cards) || cards.length < 5) return null
  if (cards.length === 5) return evaluateFive(cards)

  const combos = []
  pickFive(cards, 0, [], combos)
  let best = null
  combos.forEach(combo => {
    const cur = evaluateFive(combo)
    if (!best || compareEval(cur, best) > 0) best = cur
  })
  return best
}

function evaluateStreetHand(holeCards, boardCards) {
  if (!Array.isArray(holeCards) || holeCards.length < 2) return ''
  if (!Array.isArray(boardCards) || boardCards.length < 3) return ''
  const allCards = holeCards.concat(boardCards)
  const result = evaluateBest(allCards)
  return result ? result.label : ''
}

function buildHandFact(gameId, handNumber, logs) {
  const sortedLogs = (logs || []).slice().sort((a, b) => {
    const ta = String((a && (a.createdAt || a.created_at || a.time)) || '')
    const tb = String((b && (b.createdAt || b.created_at || b.time)) || '')
    return ta.localeCompare(tb)
  })

  let street = 'PREFLOP'
  let sbPid = ''
  let bbPid = ''
  let buttonPid = ''
  let pot = 0

  const handPlayers = {}
  const preflopOrder = []
  const preflopOrderSeen = {}
  const playerActions = {}
  const activePlayers = {}
  const foldedPlayers = {}
  const collectedPlayers = {}
  const allInPlayers = {}
  const allInStreetMap = {}
  const showCardsMap = {}
  const startingStacks = {}
  const contributions = {}
  let streetContrib = {}

  const board = {
    flop: [],
    turn: [],
    river: []
  }

  const streetSpr = {
    FLOP: { table: null, pot: null, players: {} },
    TURN: { table: null, pot: null, players: {} },
    RIVER: { table: null, pot: null, players: {} }
  }

  const vpipSet = {}
  const pfrSet = {}
  const limpSet = {}
  const sawFlopSet = {}
  const showdownSet = {}
  const showdownWinSet = {}
  const cbetOppSet = {}
  const cbetCountSet = {}
  const bet3OppSet = {}
  const bet3CountSet = {}
  const foldTo3BetOppSet = {}
  const foldTo3BetCountSet = {}
  const bet4OppSet = {}
  const bet4CountSet = {}
  const isolateOppSet = {}
  const isolateCountSet = {}
  const foldToFlopCbetOppSet = {}
  const foldToFlopCbetCountSet = {}
  const raiseVsFlopCbetOppSet = {}
  const raiseVsFlopCbetCountSet = {}

  let preflopRaiseCount = 0
  let preflopAggressor = ''
  let hasPreflopRaise = false
  const limpers = {}
  const preflopVoluntaryActors = {}
  const facedThreeBet = {}
  let flopAggressionStarted = false
  let cbetTriggered = false
  const cbetDefendersPending = {}

  function ensurePlayer(pid, name) {
    if (!pid) return
    if (!handPlayers[pid]) handPlayers[pid] = name || pid
    if (activePlayers[pid] === undefined) activePlayers[pid] = true
    if (contributions[pid] === undefined) contributions[pid] = 0
    if (streetContrib[pid] === undefined) streetContrib[pid] = 0
    getStreetActionStore(playerActions, pid)
  }

  function setStreetSpr(streetName) {
    if (!streetSpr[streetName]) return
    const node = streetSpr[streetName]
    node.pot = round(pot, 2)
    if (!node.pot || node.pot <= 0) return

    let effectiveRemain = null
    const activePlayerIds = []
    const missingStackPlayerIds = []
    Object.keys(activePlayers).forEach(pid => {
      if (!activePlayers[pid]) return
      activePlayerIds.push(pid)
      const stack = startingStacks[pid]
      if (typeof stack === 'number' && stack > 0) {
        const remain = Math.max(stack - (contributions[pid] || 0), 0)
        node.players[pid] = round(remain / node.pot, 2)
        if (effectiveRemain === null || remain < effectiveRemain) effectiveRemain = remain
      } else {
        node.players[pid] = null
        missingStackPlayerIds.push(pid)
      }
    })

    if (effectiveRemain !== null) {
      node.table = round(effectiveRemain / node.pot, 2)
    } else {
      console.warn('[match_hand_etl][SPR] 当前街未计算出有效桌面SPR', {
        gameId: gameId,
        handNumber: handNumber,
        street: streetName,
        pot: node.pot,
        activePlayers: activePlayerIds.length,
        missingStacks: missingStackPlayerIds
      })
    }

    if (missingStackPlayerIds.length > 0) {
      console.warn('[match_hand_etl][SPR] 部分活跃玩家缺少起始筹码，SPR 可能为 null', {
        gameId: gameId,
        handNumber: handNumber,
        street: streetName,
        pot: node.pot,
        parsedStacks: Object.keys(startingStacks).length,
        activePlayers: activePlayerIds.length,
        missingStacks: missingStackPlayerIds
      })
    }
  }

  sortedLogs.forEach(log => {
    const msg = String((log && log.msg) || '')
    if (!msg) return

    const structuredStacks = parseStructuredStacks(log)
    Object.keys(structuredStacks).forEach(pid => {
      startingStacks[pid] = structuredStacks[pid]
    })

    const inlineStacks = parsePlayerStacksLine(msg)
    Object.keys(inlineStacks).forEach(pid => {
      startingStacks[pid] = inlineStacks[pid]
    })

    const parsedButtonPid = parseButtonPlayer(msg)
    if (parsedButtonPid) buttonPid = parsedButtonPid

    const nextStreet = parseStreet(msg, street)
    if (nextStreet !== street) {
      street = nextStreet
      streetContrib = {}

      if (street === 'FLOP') {
        const cards = extractCardsFromText(msg)
        board.flop = cards.slice(0, 3)
        setStreetSpr('FLOP')
        Object.keys(activePlayers).forEach(pid => {
          if (activePlayers[pid]) sawFlopSet[pid] = true
        })
        if (preflopAggressor && activePlayers[preflopAggressor]) cbetOppSet[preflopAggressor] = true
      } else if (street === 'TURN') {
        const cards = extractCardsFromText(msg)
        if (cards.length >= 4) {
          board.turn = cards.slice(0, 4)
        } else if (cards.length >= 1) {
          board.turn = board.flop.concat([cards[cards.length - 1]]).slice(0, 4)
        }
        setStreetSpr('TURN')
      } else if (street === 'RIVER') {
        const cards = extractCardsFromText(msg)
        if (cards.length >= 5) {
          board.river = cards.slice(0, 5)
        } else if (cards.length >= 1) {
          board.river = board.turn.concat([cards[cards.length - 1]]).slice(0, 5)
        }
        setStreetSpr('RIVER')
      }
    }

    const actionData = parseAction(log, street)
    if (!actionData) return

    const pid = actionData.playerId
    const action = actionData.action
    ensurePlayer(pid, actionData.playerName)

    const stackFromMsg = parseStackFromMessage(msg, pid)
    if (stackFromMsg !== null && stackFromMsg > 0) startingStacks[pid] = stackFromMsg

    if (!preflopOrderSeen[pid] && street === 'PREFLOP' && action !== 'posts' && action !== 'shows' && action !== 'collected') {
      preflopOrderSeen[pid] = true
      preflopOrder.push(pid)
    }

    const actionText = actionToText(action, actionData.amount, actionData.toAmount)
    playerActions[pid][street].push(actionText)

    if (/small blind/i.test(actionData.msg) && action === 'posts') sbPid = pid
    if (/big blind/i.test(actionData.msg) && action === 'posts') bbPid = pid

    if (action === 'shows') {
      const cards = extractCardsFromText(actionData.msg)
      if (cards.length >= 2) showCardsMap[pid] = cards.slice(0, 2)
      sawFlopSet[pid] = true
    }
    if (action === 'collected') collectedPlayers[pid] = true
    if (actionData.isAllIn) {
      allInPlayers[pid] = true
      if (!allInStreetMap[pid]) allInStreetMap[pid] = street
    }

    if (action === 'folds') {
      foldedPlayers[pid] = true
      activePlayers[pid] = false
    }

    if (action === 'posts' || action === 'calls' || action === 'bets' || action === 'raises') {
      let increment = actionData.amount || 0
      if (action === 'raises' && actionData.toAmount) {
        const previous = streetContrib[pid] || 0
        increment = Math.max(0, actionData.toAmount - previous)
        streetContrib[pid] = actionData.toAmount
      } else {
        streetContrib[pid] = (streetContrib[pid] || 0) + increment
      }

      if (increment > 0) {
        pot += increment
        contributions[pid] = (contributions[pid] || 0) + increment
      }
    }

    if (street === 'PREFLOP') {
      if (action === 'calls' || action === 'bets' || action === 'raises') {
        vpipSet[pid] = true
        preflopVoluntaryActors[pid] = true
      }
      if ((action === 'bets' || action === 'raises') && !pfrSet[pid]) pfrSet[pid] = true

      if (action === 'calls' && preflopRaiseCount === 0) limpSet[pid] = true
      if (action === 'calls' && preflopRaiseCount === 0) limpers[pid] = true

      if (!hasPreflopRaise && Object.keys(limpers).length > 0 && !limpers[pid] && !isolateOppSet[pid] && action !== 'posts') {
        isolateOppSet[pid] = true
        if (action === 'bets' || action === 'raises') isolateCountSet[pid] = true
      }

      if (preflopRaiseCount === 1 && action !== 'posts' && pid !== preflopAggressor && !bet3OppSet[pid]) {
        bet3OppSet[pid] = true
        if (action === 'bets' || action === 'raises') bet3CountSet[pid] = true
      }

      if (facedThreeBet[pid] && facedThreeBet[pid].pending && action !== 'posts') {
        if (action === 'folds') foldTo3BetCountSet[pid] = true
        if (action === 'bets' || action === 'raises') bet4CountSet[pid] = true
        facedThreeBet[pid].pending = false
      }

      if (action === 'bets' || action === 'raises') {
        if (preflopRaiseCount === 1 && pid !== preflopAggressor) {
          Object.keys(preflopVoluntaryActors).forEach(targetPid => {
            if (targetPid === pid) return
            if (foldedPlayers[targetPid]) return
            foldTo3BetOppSet[targetPid] = true
            bet4OppSet[targetPid] = true
            facedThreeBet[targetPid] = { pending: true }
          })
        }

        preflopRaiseCount += 1
        hasPreflopRaise = true
        preflopAggressor = pid
      }
    } else {
      if (street === 'FLOP') {
        sawFlopSet[pid] = true

        if (!flopAggressionStarted && (action === 'bets' || action === 'raises')) {
          flopAggressionStarted = true
          if (pid === preflopAggressor) {
            cbetTriggered = true
            cbetCountSet[pid] = true
            Object.keys(activePlayers).forEach(targetPid => {
              if (targetPid === pid) return
              if (!activePlayers[targetPid]) return
              foldToFlopCbetOppSet[targetPid] = true
              raiseVsFlopCbetOppSet[targetPid] = true
              cbetDefendersPending[targetPid] = true
            })
          }
        }

        if (cbetTriggered && cbetDefendersPending[pid] && action !== 'posts' && action !== 'shows' && action !== 'collected') {
          if (action === 'folds') foldToFlopCbetCountSet[pid] = true
          if (action === 'bets' || action === 'raises') raiseVsFlopCbetCountSet[pid] = true
          cbetDefendersPending[pid] = false
        }
      }
    }
  })

  const playerIds = Object.keys(handPlayers)
  const positions = assignPositions(playerIds, sbPid, bbPid, buttonPid, preflopOrder)

  const survivors = playerIds.filter(pid => !foldedPlayers[pid])
  if (survivors.length >= 2) {
    survivors.forEach(pid => {
      showdownSet[pid] = true
    })
  }
  Object.keys(showCardsMap).forEach(pid => {
    showdownSet[pid] = true
  })
  Object.keys(showdownSet).forEach(pid => {
    if (collectedPlayers[pid]) showdownWinSet[pid] = true
  })
  Object.keys(allInPlayers).forEach(pid => {
    if (collectedPlayers[pid]) allInPlayers[pid] = true
  })

  const playerStats = playerIds.map(pid => {
    const handPlayerName = handPlayers[pid] || pid
    return {
      playerId: pid,
      playerName: handPlayerName,
      position: positions[pid] || '',
      hands: 1,
      vpipHands: vpipSet[pid] ? 1 : 0,
      pfrHands: pfrSet[pid] ? 1 : 0,
      limpHands: limpSet[pid] ? 1 : 0,
      sawFlopHands: sawFlopSet[pid] ? 1 : 0,
      bets: playerActions[pid].PREFLOP.concat(playerActions[pid].FLOP, playerActions[pid].TURN, playerActions[pid].RIVER).filter(v => v.indexOf('bets') === 0).length,
      raises: playerActions[pid].PREFLOP.concat(playerActions[pid].FLOP, playerActions[pid].TURN, playerActions[pid].RIVER).filter(v => v.indexOf('raises') === 0).length,
      calls: playerActions[pid].PREFLOP.concat(playerActions[pid].FLOP, playerActions[pid].TURN, playerActions[pid].RIVER).filter(v => v.indexOf('calls') === 0).length,
      checks: playerActions[pid].PREFLOP.concat(playerActions[pid].FLOP, playerActions[pid].TURN, playerActions[pid].RIVER).filter(v => v === 'checks').length,
      folds: playerActions[pid].PREFLOP.concat(playerActions[pid].FLOP, playerActions[pid].TURN, playerActions[pid].RIVER).filter(v => v === 'folds').length,
      showdowns: showdownSet[pid] ? 1 : 0,
      showdownWins: showdownWinSet[pid] ? 1 : 0,
      cbetOpp: cbetOppSet[pid] ? 1 : 0,
      cbetCount: cbetCountSet[pid] ? 1 : 0,
      bet3Opp: bet3OppSet[pid] ? 1 : 0,
      bet3Count: bet3CountSet[pid] ? 1 : 0,
      allInCnt: allInPlayers[pid] ? 1 : 0,
      allInWins: allInPlayers[pid] && collectedPlayers[pid] ? 1 : 0,
      foldTo3BetOpp: foldTo3BetOppSet[pid] ? 1 : 0,
      foldTo3BetCount: foldTo3BetCountSet[pid] ? 1 : 0,
      bet4Opp: bet4OppSet[pid] ? 1 : 0,
      bet4Count: bet4CountSet[pid] ? 1 : 0,
      isolateOpp: isolateOppSet[pid] ? 1 : 0,
      isolateCount: isolateCountSet[pid] ? 1 : 0,
      foldToFlopCbetOpp: foldToFlopCbetOppSet[pid] ? 1 : 0,
      foldToFlopCbetCount: foldToFlopCbetCountSet[pid] ? 1 : 0,
      raiseVsFlopCbetOpp: raiseVsFlopCbetOppSet[pid] ? 1 : 0,
      raiseVsFlopCbetCount: raiseVsFlopCbetCountSet[pid] ? 1 : 0,
      sprFlop: streetSpr.FLOP.players[pid] === undefined ? null : streetSpr.FLOP.players[pid],
      sprTurn: streetSpr.TURN.players[pid] === undefined ? null : streetSpr.TURN.players[pid],
      sprRiver: streetSpr.RIVER.players[pid] === undefined ? null : streetSpr.RIVER.players[pid],
      actions: {
        preflop: playerActions[pid].PREFLOP.slice(),
        flop: playerActions[pid].FLOP.slice(),
        turn: playerActions[pid].TURN.slice(),
        river: playerActions[pid].RIVER.slice()
      }
    }
  })

  const allInPlayerIds = Object.keys(allInPlayers)
  const isAllInHand = allInPlayerIds.length > 0

  const showdownPlayers = []
  Object.keys(showCardsMap).forEach(pid => {
    const holeCards = showCardsMap[pid]
    const rangeInfo = getRangeInfo(holeCards)

    const flopBoard = board.flop.slice()
    const turnBoard = board.turn.length ? board.turn.slice() : board.flop.slice()
    const riverBoard = board.river.length ? board.river.slice() : board.turn.slice()

    showdownPlayers.push({
      playerId: pid,
      playerName: handPlayers[pid] || pid,
      holeCards: holeCards.map(card => card.text),
      holeCardsRaw: holeCards.map(card => ({ rank: card.rank, suit: card.suit })),
      rangeKey: rangeInfo.rangeKey,
      rangeTier: rangeInfo.rangeTier,
      rangeLabel: rangeInfo.rangeLabel,
      rangeRank: rangeInfo.rangeRank,
      rangePercent: rangeInfo.rangePercent,
      rangeEquity: rangeInfo.rangeEquity,
      comboCount: rangeInfo.comboCount,
      allInHand: isAllInHand,
      isAllInPlayer: !!allInPlayers[pid],
      allInStreet: allInStreetMap[pid] || '',
      flopHandType: flopBoard.length >= 3 ? evaluateStreetHand(holeCards, flopBoard) : '',
      flopSpr: streetSpr.FLOP.players[pid] === undefined ? null : streetSpr.FLOP.players[pid],
      flopAction: playerActions[pid].FLOP.join(' -> '),
      turnHandType: turnBoard.length >= 4 ? evaluateStreetHand(holeCards, turnBoard) : '',
      turnSpr: streetSpr.TURN.players[pid] === undefined ? null : streetSpr.TURN.players[pid],
      turnAction: playerActions[pid].TURN.join(' -> '),
      riverHandType: riverBoard.length >= 5 ? evaluateStreetHand(holeCards, riverBoard) : '',
      riverSpr: streetSpr.RIVER.players[pid] === undefined ? null : streetSpr.RIVER.players[pid],
      riverAction: playerActions[pid].RIVER.join(' -> ')
    })
  })

  return {
    _id: gameId + '_' + handNumber,
    gameId: gameId,
    handNumber: handNumber,
    playerCount: playerIds.length,
    board: {
      flop: board.flop.map(card => card.text),
      turn: board.turn.map(card => card.text),
      river: board.river.map(card => card.text)
    },
    positions: positions,
    streetSpr: {
      flop: streetSpr.FLOP,
      turn: streetSpr.TURN,
      river: streetSpr.RIVER
    },
    players: playerStats,
    allInHand: isAllInHand,
    allInPlayerIds: allInPlayerIds,
    showdownPlayers: showdownPlayers,
    updateTime: new Date()
  }
}

async function upsertFact(handFact) {
  const docId = handFact._id
  const docRef = db.collection(FACT_COLLECTION).doc(docId)
  const now = new Date()
  const writeData = Object.assign({}, handFact)
  delete writeData._id

  const old = await docRef.get().catch(() => null)
  if (old && old.data) {
    const data = Object.assign({}, writeData, {
      createTime: old.data.createTime || now,
      updateTime: now
    })
    await docRef.set({ data: data })
  } else {
    const data = Object.assign({}, writeData, {
      createTime: now,
      updateTime: now
    })
    await docRef.set({ data: data })
  }
}

async function processSingleHand(gameId, handNumber) {
  const docId = gameId + '_' + handNumber
  const handRes = await db.collection('match_hands').doc(docId).get().catch(() => null)
  if (!handRes || !handRes.data) {
    return {
      ok: false,
      handNumber: handNumber,
      msg: 'match_hands 中未找到该手牌'
    }
  }

  const logs = handRes.data.raw_logs
  if (!Array.isArray(logs) || logs.length === 0) {
    return {
      ok: false,
      handNumber: handNumber,
      msg: 'raw_logs 为空'
    }
  }

  const fact = buildHandFact(gameId, handNumber, logs)
  if (!fact.players || fact.players.length === 0) {
    return {
      ok: false,
      handNumber: handNumber,
      msg: '未解析到有效玩家动作'
    }
  }
  await upsertFact(fact)
  return {
    ok: true,
    handNumber: handNumber,
    players: fact.players.length,
    showdownPlayers: fact.showdownPlayers.length
  }
}

async function processAllHandsChunk(gameId, options) {
  const startTime = Date.now()
  const MAX_DB_LIMIT = 50
  const maxRuntimeMs = Math.max(800, parseInt(options.maxRuntimeMs, 10) || 2200)
  const maxHandsPerRun = Math.max(1, parseInt(options.maxHandsPerRun, 10) || 12)
  let offset = Math.max(0, parseInt(options.startOffset, 10) || 0)

  const countRes = await db.collection('match_hands').where({ gameId: gameId }).count()
  const total = countRes.total || 0

  let processed = 0
  let skipped = 0
  let emptyPlayerHands = 0
  const details = []
  let timeUp = false

  while (offset < total && (processed + skipped) < maxHandsPerRun) {
    if (Date.now() - startTime >= maxRuntimeMs) {
      timeUp = true
      break
    }

    const remain = maxHandsPerRun - (processed + skipped)
    const limit = Math.min(MAX_DB_LIMIT, remain, total - offset)
    if (limit <= 0) break

    const batch = await db.collection('match_hands')
      .where({ gameId: gameId })
      .orderBy('handNumber', 'asc')
      .skip(offset)
      .limit(limit)
      .get()

    if (!batch.data || batch.data.length === 0) break

    for (let j = 0; j < batch.data.length; j += 1) {
      if (Date.now() - startTime >= maxRuntimeMs) {
        timeUp = true
        break
      }

      const handDoc = batch.data[j]
      const one = await processSingleHand(gameId, handDoc.handNumber)
      if (one.ok) processed += 1
      else {
        skipped += 1
        if (one.msg === '未解析到有效玩家动作') emptyPlayerHands += 1
      }
      details.push(one)
      offset += 1
    }

    if (timeUp) break
  }

  return {
    processed: processed,
    skipped: skipped,
    emptyPlayerHands: emptyPlayerHands,
    total: total,
    startOffset: Math.max(0, parseInt(options.startOffset, 10) || 0),
    nextOffset: offset,
    done: offset >= total,
    timeUp: timeUp,
    maxRuntimeMs: maxRuntimeMs,
    maxHandsPerRun: maxHandsPerRun,
    details: details.slice(-20)
  }
}

exports.main = async (event, context) => {
  const gameId = event.gameId
  const hasHandNumber = event.handNumber !== undefined && event.handNumber !== null
  const handNumber = hasHandNumber ? parseInt(event.handNumber, 10) : null
  const startOffset = Math.max(0, parseInt(event.startOffset, 10) || 0)
  const maxRuntimeMs = Math.max(800, parseInt(event.maxRuntimeMs, 10) || 2200)
  const maxHandsPerRun = Math.max(1, parseInt(event.maxHandsPerRun, 10) || 12)
  const enableRelay = event.enableRelay !== false

  if (!gameId) return { code: -1, msg: '缺少 gameId' }

  try {
    if (hasHandNumber && !isNaN(handNumber)) {
      const result = await processSingleHand(gameId, handNumber)
      if (!result.ok) {
        return {
          code: 0,
          msg: result.msg,
          data: result
        }
      }
      return {
        code: 1,
        msg: '单手 ETL 完成',
        data: result
      }
    }

    const summary = await processAllHandsChunk(gameId, {
      startOffset: startOffset,
      maxRuntimeMs: maxRuntimeMs,
      maxHandsPerRun: maxHandsPerRun
    })

    if (!summary.done && enableRelay) {
      // 异步接力，避免单次调用超时导致全量失败
      cloud.callFunction({
        name: 'match_hand_etl',
        data: {
          gameId: gameId,
          startOffset: summary.nextOffset,
          maxRuntimeMs: maxRuntimeMs,
          maxHandsPerRun: maxHandsPerRun,
          enableRelay: true
        }
      }).catch(err => {
        console.error('[match_hand_etl] relay 调用失败:', err.message)
      })
    }

    return {
      code: 1,
      msg: summary.done ? '全量 ETL 完成' : '分片 ETL 进行中，已触发接力',
      data: summary
    }
  } catch (e) {
    console.error('[match_hand_etl] 执行失败:', e)
    return {
      code: -1,
      msg: 'ETL 失败: ' + e.message
    }
  }
}
